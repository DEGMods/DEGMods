import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvents, fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { signAndPublish } from '@/lib/nostr/publish'
import { type JamDetails } from '@/lib/nostr/jam'
import { tallyJam, fetchEntries, type FullTally } from '@/lib/nostr/jamTally'
import {
  buildResultEvent, trackRows, latestResults, RESULT_TOP_N,
  type JamResultRow, type JamResults,
} from '@/lib/nostr/jamVoting'
import { KINDS } from '@/lib/constants'
import { cn } from '@/lib/utils'

type Phase = 'published' | 'confirm' | 'counting' | 'review' | 'publishing' | 'done' | 'error'

const hostOf = (url: string) => { try { return new URL(url).host } catch { return url } }
const fmtWindow = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Creator-only tally flow.
 *
 * Judges' ballots are fetched and counted exactly; community ballots are counted
 * via NIP-45 rather than downloaded, so the work is fixed by the jam's shape and
 * doesn't grow with how many people voted. Publishes one Result event (kind
 * 31343) holding the top 100 of each track, then stamps the jam.
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

  const [published, setPublished] = useState<JamResults | null>(null)
  const [loadingPublished, setLoadingPublished] = useState(false)

  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [tally, setTally] = useState<FullTally | null>(null)
  const [titles, setTitles] = useState<Map<string, string>>(new Map())
  const [searched, setSearched] = useState<string[]>([])

  const relays = () => [...new Set([...useSettingsStore.getState().getAllEnabledRelayUrls('read'), ...jam.relays])]

  // Load what was already published, so opening this shows the standing results
  // instead of silently re-running a tally that could change them.
  useEffect(() => {
    if (!open || phase !== 'published') return
    let cancelled = false
    ;(async () => {
      setLoadingPublished(true)
      try {
        const rd = relays()
        const [events, entries] = await Promise.all([
          fetchEvents(rd, { kinds: [KINDS.JAM_RESULT], authors: [jam.pubkey], '#a': [jam.aTag] }),
          fetchEntries(rd, jam),
        ])
        if (cancelled) return
        setPublished(latestResults(events))
        setTitles(new Map(entries.map((m) => [m.aTag, m.title])))
      } catch {
        /* leave empty — the view says so below */
      } finally {
        if (!cancelled) setLoadingPublished(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase])

  const run = async () => {
    setPhase('counting'); setError(null); setProgress({ done: 0, total: 0 })
    try {
      const rd = relays()
      setSearched(rd)
      const result = await tallyJam(rd, jam, (done, total) => setProgress({ done, total }))
      setTally(result)
      setTitles(new Map(result.entries.map((e) => [e.coordinate, e.title])))
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tally failed')
      setPhase('error')
    }
  }

  const publish = async () => {
    if (!tally) return
    setPhase('publishing'); setError(null)
    try {
      const results: JamResults = {
        judge: trackRows(tally.aggregates, 'judge'),
        community: trackRows(tally.aggregates, 'user'),
        truncatedAt: RESULT_TOP_N,
      }
      const res = await signAndPublish(
        buildResultEvent(jam.aTag, jam.dTag, results), undefined, 10000, jam.relays,
      )
      if (!res.success) throw new Error(res.error || 'Failed to publish results')

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

  const close = () => { if (phase !== 'counting' && phase !== 'publishing') onOpenChange(false) }

  const votingEndTs = jam.votingEnd ?? jam.end
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  const reviewJudge = tally ? trackRows(tally.aggregates, 'judge', 5) : []
  const reviewCommunity = tally ? trackRows(tally.aggregates, 'user', 5) : []
  // Community counted but every bucket came back empty — can't tell an outage
  // from a genuine shutout, so don't imply the latter.
  const communityBlank = !!tally && jam.userVotingEnabled && tally.communityAsked > 0 && tally.communityAnswered === 0

  const RowList = ({ rows, tone }: { rows: JamResultRow[]; tone: 'judge' | 'community' }) => (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={`${tone}-${r.a}`} className="flex items-baseline gap-2 rounded-md border border-[#262626] px-2.5 py-2">
          <span className={cn('shrink-0 text-xs font-semibold tabular-nums', tone === 'judge' ? 'text-amber-300' : 'text-sky-300')}>#{r.r}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{titles.get(r.a) ?? r.a}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">
            {r.s.toFixed(1)} · {r.v.toLocaleString()} {r.v === 1 ? 'vote' : 'votes'}
          </span>
        </div>
      ))}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="border-[#262626] bg-[#1a1a1a] sm:max-w-lg" onInteractOutside={(e) => { if (phase === 'counting' || phase === 'publishing') e.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="text-white">{phase === 'published' ? 'Published results' : 'Tally votes'}</DialogTitle>
          <DialogDescription className="text-neutral-400">{jam.title}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
          {phase === 'published' && (
            <div className="space-y-3">
              {loadingPublished ? (
                <div className="flex items-center gap-2 text-sm text-neutral-300"><Loader2 className="h-4 w-4 animate-spin text-[#fc4462]" /> Loading published results…</div>
              ) : published && (published.judge.length > 0 || published.community.length > 0) ? (
                <>
                  <p className="text-xs text-neutral-500">Published {jam.resultsAt ? fmtWindow(jam.resultsAt) : ''} · top {published.truncatedAt} per track</p>
                  {published.judge.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-amber-300">Judges — official result</p>
                      <RowList rows={published.judge.slice(0, 10)} tone="judge" />
                    </div>
                  )}
                  {published.community.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-sky-300">Community — audience signal</p>
                      <RowList rows={published.community.slice(0, 10)} tone="community" />
                    </div>
                  )}
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
            <div className="space-y-2 text-sm text-neutral-300">
              <p>
                Judges&apos; ballots are fetched and counted exactly. Community votes are counted by
                asking each vote relay how many ballots it holds — best effort, and votes stored only
                on a relay that&apos;s down right now can be missed.
              </p>
              <p className="text-neutral-400">
                The top {RESULT_TOP_N} of each track is published. Anything below that stays available
                from each entry&apos;s own page.
                {jam.resultsAt ? ' Anything already published will be replaced.' : ''}
              </p>
            </div>
          )}

          {phase === 'counting' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-neutral-300">
                <Loader2 className="h-4 w-4 animate-spin text-[#fc4462]" />
                {progress.total ? <>Counting votes… <span className="tabular-nums text-neutral-400">{progress.done.toLocaleString()}/{progress.total.toLocaleString()}</span></> : 'Fetching entries and judges&apos; ballots…'}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#262626]"><div className="h-full bg-[#fc4462] transition-[width]" style={{ width: `${pct}%` }} /></div>
              <p className="flex items-start gap-1.5 text-[11px] text-amber-400/90"><AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> Keep this window open until the tally finishes.</p>
            </div>
          )}

          {phase === 'review' && tally && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="rounded-md bg-[#262626] px-2.5 py-1 text-neutral-200">{tally.entries.length} {tally.entries.length === 1 ? 'entry' : 'entries'}</span>
                {jam.votingEnabled && <span className="rounded-md bg-[#262626] px-2.5 py-1 text-amber-300">{tally.judgeBallots} judge {tally.judgeBallots === 1 ? 'ballot' : 'ballots'}</span>}
                {jam.userVotingEnabled && <span className="rounded-md bg-[#262626] px-2.5 py-1 text-sky-300">{reviewCommunity.length > 0 ? 'community counted' : 'no community votes found'}</span>}
              </div>

              {tally.judgesUnverifiable && (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  No judge is listed as an npub, so their ballots can&apos;t be identified. The judge track will be empty.
                </p>
              )}

              {communityBlank && (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  No vote relay answered a single count. This means &quot;we couldn&apos;t find out&quot;, not
                  &quot;nobody voted&quot; — check your vote relays support counting before publishing.
                </p>
              )}

              <details className="text-[11px] text-neutral-500">
                <summary className="cursor-pointer list-none hover:text-neutral-300">
                  Searched {searched.length} {searched.length === 1 ? 'relay' : 'relays'} · voting window {fmtWindow(jam.end)} – {fmtWindow(votingEndTs)}
                </summary>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {searched.map((url) => <li key={url} className="truncate font-mono">{hostOf(url)}</li>)}
                </ul>
              </details>

              {reviewJudge.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-amber-300">Judges — decides the winner</p>
                  <RowList rows={reviewJudge} tone="judge" />
                </div>
              )}
              {reviewCommunity.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-sky-300">Community — audience signal</p>
                  <RowList rows={reviewCommunity} tone="community" />
                </div>
              )}
              {reviewJudge.length === 0 && reviewCommunity.length === 0 && (
                <p className="text-sm text-neutral-500">No counted votes — publishing will record an empty result.</p>
              )}
            </div>
          )}

          {phase === 'publishing' && (
            <div className="flex items-center gap-2 text-sm text-neutral-300"><Loader2 className="h-4 w-4 animate-spin text-[#fc4462]" /> Publishing results…</div>
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
