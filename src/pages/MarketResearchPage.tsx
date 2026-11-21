import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { BarChart3, Loader2, ChevronLeft } from 'lucide-react'
import type { Filter, Event as NostrEvent } from 'nostr-tools'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { extractMarketResearch, MARKET_RESEARCH_TAG, type MarketResearchEntry } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { useGamesDbStore } from '@/stores/gamesDbStore'
import { useSeoMeta } from '@/hooks/useSeoMeta'
import { SkeletonImage } from '@/components/shared/SkeletonImage'

/**
 * /game/<game>/mr — "Most wanted mods" for a game: an admin-curated list of mods
 * people want (from observed market reactions/posts), published as a NIP-78 event
 * tagged `q = <game>`. Read-only marketing surface.
 */
export function MarketResearchPage() {
  const { name } = useParams()
  const game = decodeURIComponent(name!)
  const getGameImages = useGamesDbStore((s) => s.getGameImages)
  const images = getGameImages(game)

  useSeoMeta({
    title: `${game} — most wanted mods`,
    description: `Mods people want for ${game}, based on observed market reactions and posts.`,
    image: images?.wideImage || images?.boxartImage || undefined,
  })

  const [entries, setEntries] = useState<MarketResearchEntry[]>([])
  const [event, setEvent] = useState<NostrEvent | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setEvent(null)
    ;(async () => {
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const ev = await fetchEvent(relays, {
          kinds: [KINDS.GAME_DB],
          authors: [ADMIN_PUBKEY],
          [`#${MARKET_RESEARCH_TAG}`]: [game],
        } as Filter)
        if (cancelled) return
        setEvent(ev ?? null)
        setEntries(ev ? extractMarketResearch(ev) : [])
      } catch {
        if (!cancelled) setEntries([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [game])

  // Cooperative rebroadcast: after the list has been on screen a few seconds,
  // help keep it on ≥ MIN_REDUNDANCY relays — rebroadcasting if it's under-
  // replicated, then rechecking. Cancels on navigation so a drive-by view doesn't
  // trigger it; deduped per session inside the module.
  useEffect(() => {
    if (!event) return
    const t = setTimeout(() => {
      import('@/lib/nostr/eventRedundancy').then(({ ensureEventPresent }) => ensureEventPresent(event))
    }, 8000)
    return () => clearTimeout(t)
  }, [event])

  const boxart = images?.boxartImage || images?.wideImage

  return (
    <div className="py-8">
      <Link
        to={`/game/${encodeURIComponent(game)}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-400 transition-colors hover:text-white"
      >
        <ChevronLeft size={16} /> {game} mods
      </Link>

      <div className="mb-6 flex items-start gap-4">
        {boxart && (
          <img
            src={boxart}
            alt={game}
            className="aspect-[2/3] w-20 shrink-0 rounded-lg border border-[#262626] object-cover"
          />
        )}
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-bold tracking-tight">{game}</h1>
          <p className="mt-0.5 flex items-center gap-2 text-lg font-semibold text-purple-400">
            <BarChart3 size={18} /> Most wanted mods
          </p>
          <p className="mt-1 text-sm text-neutral-400">
            Mods people want for {game}, based on observed market reactions and posts.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-neutral-500">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : entries.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">
          No most-wanted mods listed for {game} yet.
        </p>
      ) : (
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e, i) => (
            <li key={i} className="flex h-full flex-col overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c]">
              {/* Featured image — same aspect + fallback as mod cards. */}
              <div className="relative aspect-video w-full overflow-hidden bg-[#212121]">
                {e.image ? (
                  <SkeletonImage src={e.image} alt={e.title} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="text-sm text-neutral-600">No image</span>
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-xs text-neutral-600">{String(i + 1).padStart(2, '0')}</span>
                  <h2 className="min-w-0 text-base font-semibold text-neutral-100">{e.title}</h2>
                </div>
                {e.description && (
                  <p className="mt-1.5 mb-2.5 whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">{e.description}</p>
                )}
                {e.note && (
                  <p className="mt-auto rounded-r-lg border-l-2 border-purple-500/40 bg-purple-500/5 px-3 py-2 text-xs leading-relaxed text-neutral-400">
                    <span className="font-medium text-purple-400">Why: </span>{e.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
