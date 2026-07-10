import { useState, useEffect, useMemo } from 'react'
import { Search, ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { GameCard } from '@/components/game/GameCard'
import { useGamesDbStore, warmGamesDb } from '@/stores/gamesDbStore'
import { useLegacyModsStore } from '@/stores/legacyModsStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { constructModListFromEvents } from '@/lib/nostr/events'
import { KINDS, ADMIN_PUBKEY } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { GameEntry } from '@/types/game'

const GAMES_PER_PAGE = 20

// Mod-count data survives navigation so returning to /games is instant and we
// don't re-fetch every mod from all relays on every visit. Refreshed in the
// background when older than the TTL.
const MOD_COUNTS_TTL = 2 * 60 * 1000
let modCountsCache: { at: number; counts: Record<string, number>; names: string[] } | null = null

// The base sort runs over the full ~170k set. useMemo doesn't survive unmount,
// so without this a return visit re-sorts from scratch (~1s). We cache the last
// result by input reference and reuse it when nothing changed — the store's
// `games` array and the mod-count objects keep a stable identity across
// navigation, so returning to /games is instant.
let sortedBaseCache: {
  games: GameEntry[]
  names: string[]
  counts: Record<string, number>
  result: GameEntry[]
} | null = null

export function GamesPage() {
  const { games, loading: gamesLoading, syncPhase, syncDone, syncTotal, error: gamesError } = useGamesDbStore()

  const [modsByGame, setModsByGame] = useState<Record<string, number>>(() => modCountsCache?.counts ?? {})
  const [modsLoading, setModsLoading] = useState(() => !modCountsCache)
  const [search, setSearch] = useState('')
  const [modGameNames, setModGameNames] = useState<string[]>(() => modCountsCache?.names ?? [])
  const [page, setPage] = useState(1)

  // Ensure the games DB is fresh on mount. Usually a no-op here because it's
  // already warmed at app startup (see warmGamesDb) — hydration-gated and
  // TTL-throttled, so a quick return visit does no relay work.
  useEffect(() => { warmGamesDb() }, [])

  // Fetch mods for mod counts — reuse the cached result on quick return visits;
  // only hit relays when we have no data or it's gone stale (background refresh).
  useEffect(() => {
    let cancelled = false
    const fresh = modCountsCache && Date.now() - modCountsCache.at < MOD_COUNTS_TTL
    if (fresh) { setModsLoading(false); return }
    async function load() {
      const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      if (!modCountsCache) setModsLoading(true)
      try {
        const events = await fetchEvents(relayUrls, { kinds: [KINDS.MOD] }, 10000)
        if (!cancelled) {
          const mods = constructModListFromEvents(events)
          const counts: Record<string, number> = {}
          const gameNames: string[] = []
          for (const mod of mods) {
            if (mod.game) {
              counts[mod.game] = (counts[mod.game] || 0) + 1
              if (!gameNames.includes(mod.game)) gameNames.push(mod.game)
            }
          }
          modCountsCache = { at: Date.now(), counts, names: gameNames }
          setModsByGame(counts)
          setModGameNames(gameNames)
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setModsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // LEGACY: count legacy mods per game too, so the pill + sort consider them.
  const legacyMods = useLegacyModsStore((s) => s.mods)
  useEffect(() => { useLegacyModsStore.getState().load() }, [])

  // Combined current + legacy mod counts / game names. When no legacy mods are
  // loaded yet, return the SAME references so the sort cache below still skips work.
  const combinedCounts = useMemo(() => {
    if (legacyMods.length === 0) return modsByGame
    const counts: Record<string, number> = { ...modsByGame }
    for (const m of legacyMods) if (m.game) counts[m.game] = (counts[m.game] || 0) + 1
    return counts
  }, [modsByGame, legacyMods])

  const combinedNames = useMemo(() => {
    if (legacyMods.length === 0) return modGameNames
    const set = new Set(modGameNames)
    for (const m of legacyMods) if (m.game) set.add(m.game)
    return Array.from(set)
  }, [modGameNames, legacyMods])

  // Expensive base: merge DB games with games-from-mods, apply the images-only
  // filter, and sort (games-with-mods first, then alphabetical). This is done
  // over the FULL ~170k set, so it must be cheap and must NOT re-run on every
  // search keystroke — only when the underlying data or the images-only toggle
  // changes. localeCompare over 170k entries takes ~15s and blocks the route
  // transition, so we precompute a lowercase key + bucket and compare directly.
  const sortedBase = useMemo(() => {
    // Reuse the last result across mounts when the inputs are referentially
    // unchanged (avoids re-sorting 170k games on every return navigation).
    if (
      sortedBaseCache &&
      sortedBaseCache.games === games &&
      sortedBaseCache.names === combinedNames &&
      sortedBaseCache.counts === combinedCounts
    ) {
      return sortedBaseCache.result
    }

    const dbMap = new Map<string, GameEntry>()
    for (const g of games) dbMap.set(g.name.toLowerCase(), g)
    for (const name of combinedNames) {
      const k = name.toLowerCase()
      if (!dbMap.has(k)) dbMap.set(k, { name })
    }

    const result = Array.from(dbMap.values())

    // Bucket: letters (0) first, then digits (1), then everything else (2).
    const bucketOf = (name: string): number => {
      const c = name.charCodeAt(0)
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) return 0
      if (c >= 48 && c <= 57) return 1
      return 2
    }
    // Decorate once, then sort with plain comparisons (no per-compare allocation
    // or locale work). Case-insensitive via the precomputed lowercase key.
    const decorated = result.map(g => ({
      g,
      lower: g.name.toLowerCase(),
      bucket: bucketOf(g.name),
      hasMods: (combinedCounts[g.name] || 0) > 0,
    }))
    decorated.sort((a, b) => {
      if (a.hasMods !== b.hasMods) return a.hasMods ? -1 : 1
      if (a.bucket !== b.bucket) return a.bucket - b.bucket
      return a.lower < b.lower ? -1 : a.lower > b.lower ? 1 : 0
    })
    const sorted = decorated.map(d => d.g)
    sortedBaseCache = { games, names: combinedNames, counts: combinedCounts, result: sorted }
    return sorted
  }, [games, combinedNames, combinedCounts])

  // Cheap per-search filter — preserves the base order, so no re-sort on typing.
  const allGames = useMemo(() => {
    if (!search.trim()) return sortedBase
    const q = search.toLowerCase()
    return sortedBase.filter(g => g.name.toLowerCase().includes(q))
  }, [sortedBase, search])

  // Reset page when search or data changes
  useEffect(() => { setPage(1) }, [search, allGames.length])

  const totalPages = Math.max(1, Math.ceil(allGames.length / GAMES_PER_PAGE))
  const pagedGames = allGames.slice((page - 1) * GAMES_PER_PAGE, page * GAMES_PER_PAGE)

  const loading = gamesLoading || modsLoading

  // Build page number buttons
  const pageNumbers = useMemo(() => {
    const nums: (number | 'ellipsis')[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) nums.push(i)
    } else {
      nums.push(1)
      if (page > 3) nums.push('ellipsis')
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        nums.push(i)
      }
      if (page < totalPages - 2) nums.push('ellipsis')
      nums.push(totalPages)
    }
    return nums
  }, [page, totalPages])

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Games</h1>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search games..."
          className="pl-10 bg-[#1c1c1c] border-[#262626] text-white placeholder:text-neutral-500"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-400">
            {allGames.length.toLocaleString()} game{allGames.length !== 1 ? 's' : ''}
          </span>
          {syncPhase === 'checking' && (
            <span className="flex items-center gap-1.5 text-xs text-neutral-500">
              <Loader2 size={12} className="animate-spin" />
              Checking for updates…
            </span>
          )}
          {syncPhase === 'downloading' && (
            <span className="flex items-center gap-1.5 text-xs text-neutral-500">
              <Loader2 size={12} className="animate-spin" />
              Downloading {syncDone}/{syncTotal} file{syncTotal !== 1 ? 's' : ''}…
            </span>
          )}
          {syncPhase === 'error' && (
            <span className="flex items-center gap-1.5 text-xs text-red-400" title={gamesError ?? undefined}>
              <AlertTriangle size={12} />
              Sync failed{gamesError ? `: ${gamesError}` : ''}
            </span>
          )}
        </div>
      </div>

      {!ADMIN_PUBKEY && games.length === 0 && !loading && (
        <p className="text-neutral-500 text-sm">
          Games database not yet configured. Showing games with published mods.
        </p>
      )}

      {/* Grid — render cached games immediately; only show skeletons when we
          genuinely have nothing yet. Background sync/mod-count refreshes are
          signalled by the progress indicator, not by blanking the grid. */}
      {loading && allGames.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="w-full rounded-xl" style={{ aspectRatio: '2 / 3' }} />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      ) : pagedGames.length > 0 ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {pagedGames.map(game => (
              <GameCard
                key={game.name}
                game={game}
                modCount={combinedCounts[game.name]}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1.5 pt-4">
              <Button
                variant="outline" size="icon"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-8 w-8 border-[#262626] hover:bg-[#2a2a2a]"
              >
                <ChevronLeft size={14} />
              </Button>

              {pageNumbers.map((num, i) =>
                num === 'ellipsis' ? (
                  <span key={`e${i}`} className="text-neutral-600 px-1 text-sm">…</span>
                ) : (
                  <Button
                    key={num}
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(num)}
                    className={cn(
                      'h-8 min-w-[2rem] px-2.5 text-xs border-[#262626]',
                      page === num
                        ? 'bg-purple-600 border-purple-600 text-white hover:bg-purple-700'
                        : 'hover:bg-[#2a2a2a]'
                    )}
                  >
                    {num}
                  </Button>
                )
              )}

              <Button
                variant="outline" size="icon"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="h-8 w-8 border-[#262626] hover:bg-[#2a2a2a]"
              >
                <ChevronRight size={14} />
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="text-neutral-500 text-center py-16">
          No games found.
        </p>
      )}
    </div>
  )
}
