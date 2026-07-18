import { useState } from 'react'
import { Loader2, BarChart3, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settingsStore'
import { type JamDetails } from '@/lib/nostr/jam'
import { ballotCriteria } from '@/lib/nostr/jamVoting'
import { tallyEntry, type EntryTally } from '@/lib/nostr/jamTally'
import { cn } from '@/lib/utils'

/**
 * This entry's scores, computed on demand.
 *
 * Only the top 100 of each track is published, so for most entries this is the
 * only way to see a result — and during voting, before any tally exists, it's the
 * only way for anyone. Deliberately behind a button: judges cost one fetch but
 * the community track costs criteria × (max+1) count queries, which shouldn't run
 * on every page view.
 *
 * This is a live view, not a record. It reads whatever relays hold right now,
 * nothing signs it, and two people may see different numbers.
 */
export function EntryScoresPanel({ jam, entryCoordinate }: { jam: JamDetails; entryCoordinate: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [tally, setTally] = useState<EntryTally | null>(null)

  const criteria = ballotCriteria(jam)

  const load = async () => {
    setState('loading')
    try {
      const relays = [...new Set([...useSettingsStore.getState().getAllEnabledRelayUrls('read'), ...jam.relays])]
      setTally(await tallyEntry(relays, jam, entryCoordinate))
      setState('done')
    } catch {
      setState('error')
    }
  }

  if (state === 'idle') {
    return (
      <Button variant="outline" size="sm" className="w-full gap-2 border-[#262626] text-xs" onClick={load}>
        <BarChart3 className="h-3.5 w-3.5" /> Check this entry&apos;s scores
      </Button>
    )
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2.5 text-xs text-neutral-300">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#fc4462]" /> Counting votes for this entry…
      </div>
    )
  }

  if (state === 'error' || !tally) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2.5 text-xs text-neutral-400">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
        Couldn&apos;t reach enough relays to work this out. Try again in a moment.
      </div>
    )
  }

  const Track = ({
    label, tone, votes, avg, perCriterion, unknown, official,
  }: {
    label: string; tone: string; votes: number; avg: number; perCriterion: number[]; unknown?: boolean; official?: boolean
  }) => (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('text-[11px] font-medium', tone)}>{label}</span>
        {/* "Nobody voted" and "we couldn't find out" are very different claims —
            never render an outage as a confident zero. */}
        {unknown ? (
          <span className="text-[11px] text-amber-400">Couldn&apos;t be counted</span>
        ) : votes > 0 ? (
          <span className="text-[11px] tabular-nums text-neutral-300">
            {avg.toFixed(1)}/{jam.scoreMax || 10} · {votes.toLocaleString()} {votes === 1 ? 'ballot' : 'ballots'}
          </span>
        ) : (
          <span className="text-[11px] text-neutral-500">No ballots</span>
        )}
      </div>
      {!unknown && votes > 0 && criteria.length > 1 && (
        <ul className="space-y-0.5">
          {criteria.map((c, i) => (
            <li key={c.label} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-neutral-500">{c.label}</span>
              <span className="shrink-0 tabular-nums text-neutral-400">{(perCriterion[i] ?? 0).toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
      {official && votes > 0 && <p className="text-[10px] text-neutral-500">Counted exactly from signed ballots.</p>}
    </div>
  )

  return (
    <div className="space-y-3 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2.5">
      {jam.votingEnabled && (
        <Track
          label="Judges — official" tone="text-amber-300" official
          votes={tally.judge.votes} avg={tally.judge.avg} perCriterion={tally.judge.perCriterion}
        />
      )}
      {jam.userVotingEnabled && (
        <Track
          label="Community — audience signal" tone="text-sky-300"
          votes={tally.community.votes} avg={tally.community.avg} perCriterion={tally.community.perCriterion}
          unknown={tally.communityUnknown}
        />
      )}
      <p className="border-t border-[#262626] pt-2 text-[10px] leading-relaxed text-neutral-500">
        Counted live from the relays you read, not from the published results — numbers can shift as
        relays come and go.
      </p>
    </div>
  )
}
