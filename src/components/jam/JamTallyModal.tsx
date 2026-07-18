import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvents, fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { extractModData } from '@/lib/nostr/events'
import { signAndPublish } from '@/lib/nostr/publish'
import { isValidSubmission, submissionWindow, JAM_ENTRY_LABEL, type JamDetails } from '@/lib/nostr/jam'
import {
  extractBallot, isBallotCounted, judgeHexSet, aggregateResults, aggregateToRow, resultPages,
  buildResultPageEvent, mergeResultPages, type JamResultRow,
} from '@/lib/nostr/jamVoting'
import { KINDS } from '@/lib/constants'
import { cn } from '@/lib/utils'

type Phase = 'published' | 'confirm' | 'fetching' | 'review' | 'publishing' | 'done' | 'error'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const hostOf = (url: string) => { try { return new URL(url).host } catch { return url } }
const fmtWindow = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Creator-only tally flow: sweep every ballot in the voting window, aggregate two
 * ranked tracks (judges + community), then publish paged Result events (kind 31343)
 * and stamp the jam. Runs entirely client-side; anyone can recompute to verify.
 */
export function JamTallyModal({
  open,
  onOpenChange,
  jam,
  onPublished,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  jam: JamDetails
  onPublished?: () => void
}) {
  // Results already exist → show them first. Re-tallying is a deliberate choice,
  // not what happens by default when the creator opens this.
  const [phase, setPhase] = useState<Phase>(jam.resultsAt ? 'published' : 'confirm')
  const [error, setError] = useState<string | null>(null)
  const [publishedRows, setPublishedRows] = useState<JamResultRow[]>([])
  const [loadingPublished, setLoadingPublished] = useState(false)

  // Progress readouts. Fetched and counted are tracked separately: a ballot can
  // be found and still not count (cast outside the window, or its scores don't
  // match the jam's criteria), and conflating them makes that invisible.
  const [fetchedCount, setFetchedCount] = useState(0)
  const [countedCount, setCountedCount] = useState(0)
  // Which relays the sweep actually asked — a ballot living only somewhere else
  // is invisible here, and that's otherwise indistinguishable from "no vote".
  const [searched, setSearched] = useState<string[]>([])
  const [dropReasons, setDropReasons] = useState({ outsideWindow: 0, badScores: 0 })
  const [sweepProgress, setSweepProgress] = useState(0) // 0..1
  const [rows, setRows] = useState<JamResultRow[]>([])
  const [titles, setTitles] = useState<Map<string, string>>(new Map())
  const [entryCount, setEntryCount] = useState(0)
  const [pagePublished, setPagePublished] = useState(0)
  const [pageTotal, setPageTotal] = useState(0)

  const relays = () => [...new Set([...useSettingsStore.getState().getAllEnabledRelayUrls('read'), ...jam.relays])]

  /** The jam's valid entries — newest per coordinate, bounded to the submission window. */
  const loadEntries = async (rd: string[]) => {
    const w = submissionWindow(jam)
    const events = await fetchEvents(rd, { kinds: [KINDS.MOD], '#l': [JAM_ENTRY_LABEL], '#a': [jam.aTag], since: w.since, until: w.until })
    const byCoord = new Map<string, typeof events[number]>()
    for (const ev of events) {
      const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
      const key = `${ev.pubkey}:${d}`
      const cur = byCoord.get(key)
      if (!cur || ev.created_at > cur.created_at) byCoord.set(key, ev)
    }
    return [...byCoord.values()]
      .filter((ev) => !ev.tags.some((t) => t[0] === 'deleted' && t[1] === 'true'))
      .filter((ev) => isValidSubmission(ev, jam))
      .map(extractModData)
  }

  // Load what was already published, so opening this shows the standing results
  // instead of silently re-running a tally that could change them.
  useEffect(() => {
    if (!open || phase !== 'published') return
    let cancelled = false
    ;(async () => {
      setLoadingPublished(true)
      try {
        const rd = relays()
        const [resultEvents, entries] = await Promise.all([
          fetchEvents(rd, { kinds: [KINDS.JAM_RESULT], authors: [jam.pubkey], '#a': [jam.aTag] }),
          loadEntries(rd),
        ])
        if (cancelled) return
        setPublishedRows([...mergeResultPages(resultEvents).values()])
        setTitles(new Map(entries.map((m) => [m.aTag, m.title])))
      } catch {
        /* leave empty — the view shows "couldn't load" below */
      } finally {
        if (!cancelled) setLoadingPublished(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase])

  const run = async () => {
    setPhase('fetching'); setError(null)
    setFetchedCount(0); setCountedCount(0); setSweepProgress(0)
    setDropReasons({ outsideWindow: 0, badScores: 0 })
    try {
      const rd = relays()
      setSearched(rd)

      // 1. Entries — newest per coordinate, valid submissions only.
      const validEntries = await loadEntries(rd)
      const entryCoordinates = validEntries.map((m) => m.aTag)
      const titleMap = new Map(validEntries.map((m) => [m.aTag, m.title]))
      setTitles(titleMap)
      setEntryCount(entryCoordinates.length)

      // 2. Sweep ballots across the voting window [end, voting_end], newest→oldest.
      // Bounded at the relay: a ballot outside the window can never count, and
      // fetching the whole jam just to report it as dropped isn't worth the extra
      // traffic on every tally. The editor stops the dates moving under a cast
      // ballot, and a voter is warned when theirs falls outside.
      const votingEnd = jam.votingEnd ?? jam.end
      const span = Math.max(1, votingEnd - jam.end)
      const seen = new Map<string, Awaited<ReturnType<typeof fetchEvents>>[number]>() // coordinate → newest event
      let until = votingEnd
      for (let round = 0; round < 300; round++) {
        const batch = await fetchEvents(rd, {
          kinds: [KINDS.JAM_BALLOT],
          '#a': [jam.aTag],
          since: jam.end,
          until,
          limit: 500,
        })
        if (batch.length === 0) break
        let min = Infinity
        for (const ev of batch) {
          const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
          const key = `${KINDS.JAM_BALLOT}:${ev.pubkey}:${d}`
          const cur = seen.get(key)
          if (!cur || ev.created_at > cur.created_at) seen.set(key, ev)
          if (ev.created_at < min) min = ev.created_at
        }
        setFetchedCount(seen.size)
        setSweepProgress(Math.min(1, (votingEnd - min) / span))
        if (min === Infinity || min <= jam.end) break
        const nextUntil = min - 1
        if (nextUntil >= until) break // no progress — stop
        until = nextUntil
      }
      setSweepProgress(1)

      // 3. Validate + parse, tracking *why* anything was rejected so the review
      // can explain a shortfall instead of just showing a smaller number. In
      // practice that means mismatched scores — the sweep is already bounded to
      // the window, so an out-of-window ballot only reaches here from a relay
      // that ignored our since/until.
      const judges = judgeHexSet(jam.judges)
      let outsideWindow = 0
      let badScores = 0
      for (const ev of seen.values()) {
        if (isBallotCounted(ev, jam)) continue
        if (ev.created_at < jam.end || ev.created_at > votingEnd) outsideWindow++
        else badScores++
      }
      setDropReasons({ outsideWindow, badScores })

      const counted = [...seen.values()]
        .filter((ev) => isBallotCounted(ev, jam))
        .map(extractBallot)
        .filter((b): b is NonNullable<typeof b> => !!b)
      setCountedCount(counted.length)

      // 4. Aggregate + rank.
      const aggregates = aggregateResults(entryCoordinates, counted, judges)
      const resultRows = aggregates.map(aggregateToRow)
      setRows(resultRows)
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tally failed')
      setPhase('error')
    }
  }

  const publish = async () => {
    setPhase('publishing'); setError(null)
    try {
      const pages = resultPages(rows, 100)
      setPageTotal(pages.length); setPagePublished(0)

      for (let i = 0; i < pages.length; i++) {
        const ev = buildResultPageEvent(jam.aTag, jam.dTag, i, pages.length, pages[i])
        let ok = false
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          const res = await signAndPublish(ev, undefined, 10000, jam.relays)
          ok = res.success
          if (!ok) await sleep(1000 * (attempt + 1)) // back off, then retry this page
        }
        if (!ok) throw new Error(`Failed to publish results page ${i + 1}/${pages.length}`)
        setPagePublished(i + 1)
      }

      // Stamp the jam with a results timestamp (edit → created_at = prev + 1).
      const rd = relays()
      const latest = await fetchLatestEvent(rd, { kinds: [KINDS.JAM], authors: [jam.pubkey], '#d': [jam.dTag] })
      if (latest) {
        const ts = Math.floor(Date.now() / 1000)
        const tags = latest.tags.filter((t) => t[0] !== 'results')
        tags.push(['results', String(ts)])
        await signAndPublish(
          { kind: latest.kind, content: latest.content, tags, created_at: latest.created_at + 1, pubkey: '' },
          undefined, 10000, jam.relays,
        )
      }

      setPhase('done')
      toast.success('Results published!')
      onPublished?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publishing failed')
      setPhase('error')
    }
  }

  const close = () => { if (phase !== 'fetching' && phase !== 'publishing') onOpenChange(false) }

  // Found but not counted — surfaced so a creator can tell "nobody voted" apart
  // from "votes arrived but were rejected".
  const dropped = Math.max(0, fetchedCount - countedCount)
  const scoreMax = jam.scoreMax || 10
  const votingEndTs = jam.votingEnd ?? jam.end

  // By judge rank, then user rank.
  const rank = (list: JamResultRow[]) => [...list]
    .filter((r) => r.jRank > 0 || r.uRank > 0)
    .sort((a, b) => (a.jRank || 999) - (b.jRank || 999) || (a.uRank || 999) - (b.uRank || 999))

  const topRows = rank(rows).slice(0, 5) // review preview
  const standingRows = rank(publishedRows)

  const rowLines = (r: JamResultRow) => (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
      {jam.votingEnabled && (
        <span className="text-amber-300">
          {r.judge.votes > 0
            ? `Judges’ rank #${r.jRank} — ${r.judge.avg.toFixed(1)}/${scoreMax} average across ${r.judge.votes} ${r.judge.votes === 1 ? 'ballot' : 'ballots'}`
            : 'Judges — no ballots'}
        </span>
      )}
      {jam.userVotingEnabled && (
        <span className="text-sky-300">
          {r.user.votes > 0
            ? `Community rank #${r.uRank} — ${r.user.avg.toFixed(1)}/${scoreMax} average across ${r.user.votes} ${r.user.votes === 1 ? 'ballot' : 'ballots'}`
            : 'Community — no ballots'}
        </span>
      )}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="border-[#262626] bg-[#1a1a1a] sm:max-w-lg" onInteractOutside={(e) => { if (phase === 'fetching' || phase === 'publishing') e.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="text-white">{phase === 'published' ? 'Published results' : 'Tally votes'}</DialogTitle>
          <DialogDescription className="text-neutral-400">{jam.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {phase === 'published' && (
            <div className="space-y-3">
              {loadingPublished ? (
                <div className="flex items-center gap-2 text-sm text-neutral-300"><Loader2 className="h-4 w-4 animate-spin text-[#fc4462]" /> Loading published results…</div>
              ) : standingRows.length > 0 ? (
                <>
                  <p className="text-xs text-neutral-500">Published {jam.resultsAt ? fmtWindow(jam.resultsAt) : ''}</p>
                  <div className="space-y-1.5">
                    {standingRows.map((r) => (
                      <div key={r.a} className="space-y-1 rounded-md border border-[#262626] px-2.5 py-2">
                        <p className="truncate text-sm text-neutral-200">{titles.get(r.a) ?? r.a}</p>
                        {rowLines(r)}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-neutral-500">
                  Results are marked as published, but none could be loaded from the relays you&apos;re reading.
                  Re-tallying will recompute and republish them.
                </p>
              )}
            </div>
          )}

          {phase === 'confirm' && (
            <p className="text-sm text-neutral-300">
              This counts every ballot in the voting window, ranks the entries, and publishes the results.
              {jam.resultsAt ? ' Anything already published will be replaced.' : ' You can re-run it later if more votes arrive.'}
            </p>
          )}

          {phase === 'fetching' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-neutral-300"><Loader2 className="h-4 w-4 animate-spin text-[#fc4462]" /> Finding ballots… <span className="tabular-nums text-neutral-400">{fetchedCount.toLocaleString()}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-[#262626]"><div className="h-full bg-[#fc4462] transition-[width]" style={{ width: `${Math.round(sweepProgress * 100)}%` }} /></div>
              <p className="flex items-start gap-1.5 text-[11px] text-amber-400/90"><AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> Keep this window open until the tally finishes.</p>
            </div>
          )}

          {phase === 'review' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="rounded-md bg-[#262626] px-2.5 py-1 text-neutral-200">{entryCount} {entryCount === 1 ? 'entry' : 'entries'}</span>
                <span className="rounded-md bg-[#262626] px-2.5 py-1 text-neutral-200">{countedCount.toLocaleString()} {countedCount === 1 ? 'ballot counts' : 'ballots count'}</span>
                {dropped > 0 && (
                  <span className="rounded-md bg-amber-500/10 px-2.5 py-1 text-amber-300">{dropped.toLocaleString()} dropped</span>
                )}
              </div>
              {dropped > 0 && (
                <ul className="space-y-0.5 text-[11px] leading-relaxed text-neutral-500">
                  {dropReasons.outsideWindow > 0 && (
                    <li>
                      {dropReasons.outsideWindow === 1 ? '1 ballot was' : `${dropReasons.outsideWindow} ballots were`} cast
                      outside the voting window ({fmtWindow(jam.end)} – {fmtWindow(votingEndTs)}) — voting only counts once submissions close.
                    </li>
                  )}
                  {dropReasons.badScores > 0 && (
                    <li>
                      {dropReasons.badScores === 1 ? "1 ballot's scores didn't" : `${dropReasons.badScores} ballots' scores didn't`} match
                      this jam&apos;s criteria exactly.
                    </li>
                  )}
                </ul>
              )}
              <details className="text-[11px] text-neutral-500">
                <summary className="cursor-pointer list-none hover:text-neutral-300">
                  Searched {searched.length} {searched.length === 1 ? 'relay' : 'relays'} — a ballot stored only elsewhere can&apos;t be counted
                </summary>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {searched.map((url) => <li key={url} className="truncate font-mono">{hostOf(url)}</li>)}
                </ul>
              </details>
              {topRows.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-neutral-400">Preview (top {topRows.length})</p>
                  {topRows.map((r) => (
                    <div key={r.a} className="space-y-1 rounded-md border border-[#262626] px-2.5 py-2">
                      <p className="truncate text-sm text-neutral-200">{titles.get(r.a) ?? r.a}</p>
                      {rowLines(r)}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-neutral-500">No counted votes yet — publishing will record an empty result.</p>
              )}
            </div>
          )}

          {phase === 'publishing' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-neutral-300"><Loader2 className="h-4 w-4 animate-spin text-[#fc4462]" /> Publishing results… <span className="tabular-nums text-neutral-400">{pagePublished}/{pageTotal} pages</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-[#262626]"><div className="h-full bg-[#fc4462] transition-[width]" style={{ width: `${pageTotal ? Math.round((pagePublished / pageTotal) * 100) : 0}%` }} /></div>
              <p className="flex items-start gap-1.5 text-[11px] text-amber-400/90"><AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> Keep this window open until publishing finishes.</p>
            </div>
          )}

          {phase === 'done' && (
            <div className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Results are live. Ranks now show on every entry.</div>
          )}

          {phase === 'error' && (
            <div className="flex items-start gap-2 text-sm text-red-400"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</div>
          )}
        </div>

        <DialogFooter>
          {phase === 'published' && (
            <>
              <Button variant="outline" className="border-[#262626]" onClick={() => onOpenChange(false)}>Close</Button>
              <Button disabled={loadingPublished} onClick={() => setPhase('confirm')} className="gap-2 bg-[#fc4462] text-white hover:bg-[#e23a56]">Re-tally votes</Button>
            </>
          )}
          {phase === 'confirm' && (
            <>
              {jam.resultsAt && <Button variant="outline" className="border-[#262626]" onClick={() => setPhase('published')}>Back</Button>}
              <Button onClick={run} className="gap-2 bg-[#fc4462] text-white hover:bg-[#e23a56]">Start tally</Button>
            </>
          )}
          {phase === 'review' && (
            <>
              <Button variant="outline" className="border-[#262626]" onClick={() => setPhase('confirm')}>Back</Button>
              <Button onClick={publish} className="gap-2 bg-[#fc4462] text-white hover:bg-[#e23a56]">Publish results</Button>
            </>
          )}
          {phase === 'done' && <Button variant="outline" className="border-[#262626]" onClick={() => onOpenChange(false)}>Close</Button>}
          {phase === 'error' && (
            <>
              <Button variant="outline" className="border-[#262626]" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={run} className="gap-2 bg-[#fc4462] text-white hover:bg-[#e23a56]">Retry</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
