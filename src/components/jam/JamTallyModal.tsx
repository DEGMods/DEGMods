import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, AlertCircle, Scale, Trophy } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvents, fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { extractModData } from '@/lib/nostr/events'
import { signAndPublish } from '@/lib/nostr/publish'
import { isValidSubmission, JAM_ENTRY_LABEL, type JamDetails } from '@/lib/nostr/jam'
import {
  extractBallot, isBallotCounted, judgeHexSet, aggregateResults, aggregateToRow, resultPages,
  buildResultPageEvent, type JamResultRow,
} from '@/lib/nostr/jamVoting'
import { KINDS } from '@/lib/constants'
import { cn } from '@/lib/utils'

type Phase = 'confirm' | 'fetching' | 'review' | 'publishing' | 'done' | 'error'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
  const [phase, setPhase] = useState<Phase>('confirm')
  const [error, setError] = useState<string | null>(null)

  // Progress readouts.
  const [ballotCount, setBallotCount] = useState(0)
  const [sweepProgress, setSweepProgress] = useState(0) // 0..1
  const [rows, setRows] = useState<JamResultRow[]>([])
  const [titles, setTitles] = useState<Map<string, string>>(new Map())
  const [entryCount, setEntryCount] = useState(0)
  const [pagePublished, setPagePublished] = useState(0)
  const [pageTotal, setPageTotal] = useState(0)

  const relays = () => [...new Set([...useSettingsStore.getState().getAllEnabledRelayUrls('read'), ...jam.relays])]

  const run = async () => {
    setPhase('fetching'); setError(null)
    setBallotCount(0); setSweepProgress(0)
    try {
      const rd = relays()

      // 1. Entries — newest per coordinate, valid submissions only.
      const entryEvents = await fetchEvents(rd, { kinds: [KINDS.MOD], '#l': [JAM_ENTRY_LABEL], '#a': [jam.coordinate] })
      const byCoord = new Map<string, typeof entryEvents[number]>()
      for (const ev of entryEvents) {
        const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
        const key = `${ev.pubkey}:${d}`
        const cur = byCoord.get(key)
        if (!cur || ev.created_at > cur.created_at) byCoord.set(key, ev)
      }
      const validEntries = [...byCoord.values()]
        .filter((ev) => !ev.tags.some((t) => t[0] === 'deleted' && t[1] === 'true'))
        .filter((ev) => isValidSubmission(ev, jam))
        .map(extractModData)
      const entryCoordinates = validEntries.map((m) => m.aTag)
      const titleMap = new Map(validEntries.map((m) => [m.aTag, m.title]))
      setTitles(titleMap)
      setEntryCount(entryCoordinates.length)

      // 2. Sweep ballots across the window [end, voting_end], newest→oldest.
      const votingEnd = jam.votingEnd ?? jam.end
      const span = Math.max(1, votingEnd - jam.end)
      const seen = new Map<string, typeof entryEvents[number]>() // coordinate → newest event
      let until = votingEnd
      for (let round = 0; round < 300; round++) {
        const batch = await fetchEvents(rd, {
          kinds: [KINDS.JAM_BALLOT],
          '#a': [jam.coordinate],
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
        setBallotCount(seen.size)
        setSweepProgress(Math.min(1, (votingEnd - min) / span))
        if (min === Infinity || min <= jam.end) break
        const nextUntil = min - 1
        if (nextUntil >= until) break // no progress — stop
        until = nextUntil
      }
      setSweepProgress(1)

      // 3. Validate + parse.
      const judges = judgeHexSet(jam.judges)
      const counted = [...seen.values()]
        .filter((ev) => isBallotCounted(ev, jam))
        .map(extractBallot)
        .filter((b): b is NonNullable<typeof b> => !!b)

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
        const ev = buildResultPageEvent(jam.coordinate, jam.dTag, i, pages.length, pages[i])
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

  // Top entries for the review preview (by judge rank, then user rank).
  const topRows = [...rows]
    .filter((r) => r.jRank > 0 || r.uRank > 0)
    .sort((a, b) => (a.jRank || 999) - (b.jRank || 999) || (a.uRank || 999) - (b.uRank || 999))
    .slice(0, 5)

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="border-[#262626] bg-[#1a1a1a] sm:max-w-lg" onInteractOutside={(e) => { if (phase === 'fetching' || phase === 'publishing') e.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white"><Scale className="h-4 w-4 text-[#fc4462]" /> Tally votes</DialogTitle>
          <DialogDescription className="text-neutral-400">{jam.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {phase === 'confirm' && (
            <p className="text-sm text-neutral-300">
              This counts every ballot in the voting window, ranks the entries, and publishes the results.
              You can re-run it later if more votes arrive.
            </p>
          )}

          {phase === 'fetching' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-neutral-300"><Loader2 className="h-4 w-4 animate-spin text-[#fc4462]" /> Counting ballots… <span className="tabular-nums text-neutral-400">{ballotCount.toLocaleString()}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-[#262626]"><div className="h-full bg-[#fc4462] transition-[width]" style={{ width: `${Math.round(sweepProgress * 100)}%` }} /></div>
              <p className="flex items-start gap-1.5 text-[11px] text-amber-400/90"><AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> Keep this window open until the tally finishes.</p>
            </div>
          )}

          {phase === 'review' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="rounded-md bg-[#262626] px-2.5 py-1 text-neutral-200">{entryCount} entries</span>
                <span className="rounded-md bg-[#262626] px-2.5 py-1 text-neutral-200">{ballotCount.toLocaleString()} ballots counted</span>
              </div>
              {topRows.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-neutral-400">Preview (top {topRows.length})</p>
                  {topRows.map((r) => (
                    <div key={r.a} className="flex items-center justify-between gap-2 rounded-md border border-[#262626] px-2.5 py-1.5 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5 text-neutral-200"><Trophy className="h-3.5 w-3.5 shrink-0 text-[#fc4462]" /> <span className="truncate">{titles.get(r.a) ?? r.a}</span></span>
                      <span className="flex shrink-0 gap-2 text-xs">
                        {jam.votingEnabled && r.jRank > 0 && <span className="text-amber-300">J#{r.jRank} · {r.judge.avg.toFixed(1)}</span>}
                        {jam.userVotingEnabled && r.uRank > 0 && <span className="text-sky-300">C#{r.uRank} · {r.user.avg.toFixed(1)}</span>}
                      </span>
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
          {phase === 'confirm' && <Button onClick={run} className="gap-2 bg-[#fc4462] text-white hover:bg-[#e23a56]">Start tally</Button>}
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
