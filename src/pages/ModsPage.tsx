import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, X, Loader2 } from 'lucide-react'
import type { Filter } from 'nostr-tools'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ModCard } from '@/components/mod/ModCard'
import { SearchBar } from '@/components/search/SearchBar'
import { ModFiltersBar } from '@/components/search/ModFiltersBar'
import { AdvancedSearch } from '@/components/search/AdvancedSearch'
import { useModFiltersStore } from '@/stores/modFiltersStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProgressiveMods } from '@/hooks/useProgressiveMods'
import { useLegacyModsStore } from '@/stores/legacyModsStore' // LEGACY
import { withLegacyMods, LEGACY_MOD_KIND, LEGACY_GAMEMOD_TAG } from '@/lib/mods/legacy' // LEGACY
import { countEvents } from '@/lib/nostr/relay-pool'
import { useModerationFilter } from '@/hooks/useModeration'
import { useBlockFilter } from '@/hooks/useBlock'
import { useWotModFilter, useWotHiddenCount } from '@/hooks/useWot'
import { useFollowedSet } from '@/hooks/useFollowedSet'
import { applyModFilters } from '@/lib/mods/filterMods'
import { KINDS } from '@/lib/constants'
import { cn } from '@/lib/utils'

const MODS_PER_PAGE = 20

export function ModsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const categoryFilter = searchParams.get('category') ?? ''
  const tagFilter = searchParams.get('tag') ?? ''
  const { nsfwMode, sources, searchTags, excludedTags, categoryFilters, repostMode, emulationMode, legacyMode } = useModFiltersStore()
  const minPow = useSettingsStore((s) => s.powFilterDifficulty)
  const [search, setSearch] = useState('')
  const [advanced, setAdvanced] = useState<Filter | null>(null)
  const [page, setPage] = useState(1)

  const baseFilter = useMemo<Filter>(() => advanced ?? { kinds: [KINDS.MOD] }, [advanced])
  const { mods: newMods, loading, loadingMore, reachedEnd, loadMore } = useProgressiveMods(baseFilter)

  // LEGACY: merge in the old kind-30402 mods (loaded once, filtered client-side).
  const legacyMods = useLegacyModsStore((s) => s.mods)
  const legacyLoading = useLegacyModsStore((s) => s.loading)
  useEffect(() => { useLegacyModsStore.getState().load() }, [])
  const allMods = useMemo(() => withLegacyMods(newMods, legacyMods), [newMods, legacyMods])
  // Hold the skeletons until BOTH fetches settle so legacy mods don't pop in
  // (and reflow the grid) after the current-mod fetch alone finishes. Skip the
  // wait when legacy is hidden, since none would be shown anyway.
  const showSkeleton = loading || (legacyMode !== 'hide' && legacyLoading)

  // Relay-reported totals (NIP-45) — the true counts, not just what's loaded.
  const [counts, setCounts] = useState<{ current: number; legacy: number } | null>(null)
  useEffect(() => {
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    Promise.all([
      countEvents(relays, { kinds: [KINDS.MOD] }),
      countEvents(relays, { kinds: [LEGACY_MOD_KIND], '#t': [LEGACY_GAMEMOD_TAG] }),
    ]).then(([current, legacy]) => setCounts({ current, legacy })).catch(() => { /* NIP-45 unsupported */ })
  }, [])

  const moderate = useModerationFilter()
  const blockFilter = useBlockFilter()
  const wotFilter = useWotModFilter()

  const availableClients = useMemo(
    () => [...new Set(allMods.map(m => m.client).filter((c): c is string => !!c))].sort(),
    [allMods],
  )

  const powExempt = useFollowedSet()
  const preWot = useMemo(() => {
    let result = blockFilter(moderate(applyModFilters(allMods, { nsfwMode, minPow, sources, searchTags, excludedTags, categoryFilters, repostMode, emulationMode, legacyMode, powExempt })))

    // Category filter from URL (hierarchical: matches the chain prefix)
    if (categoryFilter) {
      result = result.filter(m =>
        m.categories.some(c => c === categoryFilter || c.startsWith(categoryFilter + ':'))
      )
    }

    // Tag filter from URL
    if (tagFilter) {
      const t = tagFilter.toLowerCase()
      result = result.filter(m => m.tags.some(tag => tag.toLowerCase() === t))
    }

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(m =>
        m.title.toLowerCase().includes(q) ||
        m.game.toLowerCase().includes(q) ||
        m.tags.some(t => t.toLowerCase().includes(q))
      )
    }

    return result
  }, [moderate, blockFilter, allMods, search, nsfwMode, minPow, sources, searchTags, excludedTags, categoryFilters, repostMode, emulationMode, legacyMode, categoryFilter, tagFilter, powExempt])

  const filtered = useMemo(() => wotFilter(preWot), [wotFilter, preWot])
  const wotHiddenCount = useWotHiddenCount(preWot)

  const totalPages = Math.max(1, Math.ceil(filtered.length / MODS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice(
    (currentPage - 1) * MODS_PER_PAGE,
    currentPage * MODS_PER_PAGE
  )

  // Reset to page 1 on filter changes
  useEffect(() => { setPage(1) }, [search, advanced, nsfwMode, minPow, sources, searchTags, excludedTags, categoryFilters, repostMode, emulationMode, legacyMode, categoryFilter, tagFilter])

  // Prefetch an older batch as the user nears the last loaded page.
  useEffect(() => {
    if (!loading && !reachedEnd && currentPage >= totalPages - 1) loadMore()
  }, [currentPage, totalPages, reachedEnd, loading, loadMore])

  // Page buttons with ellipses (the list grows as more mods are fetched).
  const pageNumbers = useMemo(() => {
    const nums: (number | 'ellipsis')[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) nums.push(i)
    } else {
      nums.push(1)
      if (currentPage > 3) nums.push('ellipsis')
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) nums.push(i)
      if (currentPage < totalPages - 2) nums.push('ellipsis')
      nums.push(totalPages)
    }
    return nums
  }, [currentPage, totalPages])

  const clearUrlFilter = (key: 'category' | 'tag') => {
    const next = new URLSearchParams(searchParams)
    next.delete(key)
    setSearchParams(next)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Mods</h1>
        <Link to="/submit">
          <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5">
            <Plus size={14} />
            Submit Mod
          </Button>
        </Link>
      </div>

      {/* Active URL filters */}
      {(categoryFilter || tagFilter || advanced) && (
        <div className="flex flex-wrap items-center gap-2">
          {advanced && (
            <button
              onClick={() => setAdvanced(null)}
              className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-sm text-purple-300 hover:bg-purple-500/20"
            >
              Advanced search active
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {categoryFilter && (
            <button
              onClick={() => clearUrlFilter('category')}
              className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-sm text-purple-300 hover:bg-purple-500/20"
            >
              Category: {categoryFilter}
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {tagFilter && (
            <button
              onClick={() => clearUrlFilter('tag')}
              className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-sm text-purple-300 hover:bg-purple-500/20"
            >
              Tag: {tagFilter}
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Quick local search (doesn't search servers) by title, game, or tags..."
          />
        </div>
        <AdvancedSearch
          active={!!advanced}
          onSearch={setAdvanced}
          onClear={() => setAdvanced(null)}
        />
      </div>

      {/* Filters */}
      <ModFiltersBar
        availableClients={availableClients}
        resultCount={filtered.length}
        currentCount={counts?.current}
        legacyCount={counts?.legacy}
        wotHiddenCount={wotHiddenCount}
      />

      {/* Grid */}
      {showSkeleton ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : paginated.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {paginated.map(mod => (
            <ModCard key={mod.aTag} mod={mod} />
          ))}
        </div>
      ) : (
        <p className="text-neutral-500 text-center py-16">
          No mods match your filters.
        </p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className={cn(
              'p-2 rounded-lg transition-colors',
              currentPage <= 1
                ? 'text-neutral-600 cursor-not-allowed'
                : 'text-neutral-400 hover:bg-[#2a2a2a]'
            )}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {pageNumbers.map((num, i) =>
            num === 'ellipsis' ? (
              <span key={`e${i}`} className="px-1 text-sm text-neutral-600">…</span>
            ) : (
              <button
                key={num}
                onClick={() => setPage(num)}
                className={cn(
                  'w-8 h-8 rounded-lg text-sm font-medium transition-colors',
                  num === currentPage
                    ? 'bg-purple-600 text-white'
                    : 'text-neutral-400 hover:bg-[#2a2a2a]'
                )}
              >
                {num}
              </button>
            )
          )}

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages && reachedEnd}
            className={cn(
              'p-2 rounded-lg transition-colors',
              currentPage >= totalPages && reachedEnd
                ? 'text-neutral-600 cursor-not-allowed'
                : 'text-neutral-400 hover:bg-[#2a2a2a]'
            )}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {loadingMore && (
        <div className="flex items-center justify-center gap-2 py-1 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading more mods…
        </div>
      )}
    </div>
  )
}
