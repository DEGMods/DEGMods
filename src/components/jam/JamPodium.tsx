import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { ModCard } from '@/components/mod/ModCard'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { KINDS } from '@/lib/constants'
import { fetchEntries } from '@/lib/nostr/jamTally'
import { latestResults, type JamResultRow } from '@/lib/nostr/jamVoting'
import type { JamDetails } from '@/lib/nostr/jam'
import type { ModDetails } from '@/types/mod'
import { cn } from '@/lib/utils'

/** Podium styling per place. Index 0 is unused so the rank reads as the index. */
const PLACE = [
  null,
  { label: '1st', ring: 'ring-amber-400/50', chip: 'bg-amber-400 text-black' },
  { label: '2nd', ring: 'ring-neutral-300/40', chip: 'bg-neutral-300 text-black' },
  { label: '3rd', ring: 'ring-amber-700/50', chip: 'bg-amber-700 text-white' },
] as const

/**
 * The jam's top three, shown once results are published.
 *
 * Deliberately reads only the *published* result event rather than re-tallying:
 * the standings a reader sees here are the ones the organiser signed, so they
 * can't drift from the announcement because a late ballot or a slow relay
 * changed the count between two page loads. Re-running the tally is still
 * available behind "View results" for anyone who wants to verify it.
 *
 * Renders nothing at all until there's something to show — before results are
 * published, and for a jam whose top three didn't resolve to fetchable mods.
 */
export function JamPodium({ jam }: { jam: JamDetails }) {
  const [top, setTop] = useState<{ row: JamResultRow; mod: ModDetails }[]>([])

  useEffect(() => {
    // `resultsAt` is the organiser's own marker that results exist. Gating on it
    // keeps every jam that hasn't finished from paying for two relay queries.
    if (!jam.resultsAt) { setTop([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const relays = [...new Set([
          ...useSettingsStore.getState().getAllEnabledRelayUrls('read'),
          ...jam.relays,
        ])]
        const [resultEvents, entries] = await Promise.all([
          fetchEvents(relays, { kinds: [KINDS.JAM_RESULT], authors: [jam.pubkey], '#a': [jam.aTag] }),
          fetchEntries(relays, jam),
        ])
        if (cancelled) return
        const results = latestResults(resultEvents)
        if (!results) return
        const byCoord = new Map(entries.map((m) => [m.aTag, m]))
        const rows = results.judge
          .filter((r) => r.r >= 1 && r.r <= 3)
          .sort((a, b) => a.r - b.r)
          .map((row) => ({ row, mod: byCoord.get(row.a) }))
          // An entry that was deleted after results were published no longer
          // resolves. Drop it rather than render a placeholder card.
          .filter((x): x is { row: JamResultRow; mod: ModDetails } => !!x.mod)
        setTop(rows)
      } catch {
        /* leave empty — the section simply doesn't render */
      }
    })()
    return () => { cancelled = true }
  }, [jam])

  if (top.length === 0) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <Trophy className="h-5 w-5 text-[#fc4462]" />
        <h2 className="text-xl font-semibold">Winners</h2>
        <span className="text-xs text-neutral-500">Judged results, as published</span>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {top.map(({ row, mod }) => {
          const place = PLACE[row.r] ?? PLACE[3]!
          return (
            <div key={row.a} className={cn('relative rounded-xl ring-2', place.ring)}>
              <div className="absolute -top-2 -left-2 z-10">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={cn(
                      'flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold shadow-md shadow-black/40',
                      place.chip,
                    )}>
                      {place.label} · {row.s}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Average judge score {row.s} from {row.v} ballot{row.v === 1 ? '' : 's'}
                  </TooltipContent>
                </Tooltip>
              </div>
              <ModCard mod={mod} />
            </div>
          )
        })}
      </div>
    </section>
  )
}
