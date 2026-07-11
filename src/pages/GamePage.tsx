import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { Gamepad2, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useSeoMeta } from '@/hooks/useSeoMeta'
import type { Filter } from 'nostr-tools'
import { Skeleton } from '@/components/ui/skeleton'
import { ModCard } from '@/components/mod/ModCard'
import { ModFiltersBar } from '@/components/search/ModFiltersBar'
import { AdvancedSearch } from '@/components/search/AdvancedSearch'
import { useGamesDbStore } from '@/stores/gamesDbStore'
import { useModFiltersStore } from '@/stores/modFiltersStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProgressiveMods } from '@/hooks/useProgressiveMods'
import { useLegacyModsStore } from '@/stores/legacyModsStore' // LEGACY
import { withLegacyMods } from '@/lib/mods/legacy' // LEGACY
import { useModerationFilter } from '@/hooks/useModeration'
import { useBlockFilter } from '@/hooks/useBlock'
import { useWotModFilter, useWotHiddenCount } from '@/hooks/useWot'
import { useFollowedSet } from '@/hooks/useFollowedSet'
import { applyModFilters } from '@/lib/mods/filterMods'
import { KINDS } from '@/lib/constants'
import { cn } from '@/lib/utils'

const MODS_PER_PAGE = 20

export function GamePage() {
  const { name } = useParams()
  const gameName = decodeURIComponent(name!)
  const getGameImages = useGamesDbStore(s => s.getGameImages)
  const images = getGameImages(gameName)
  useSeoMeta({
    title: `${gameName} mods`,
    description: `Browse and download game mods for ${gameName} on DEG MODS.`,
    image: images?.wideImage || images?.boxartImage || undefined,
  })
  const { nsfwMode, sources, searchTags, excludedTags, categoryFilters, repostMode, emulationMode, legacyMode } = useModFiltersStore()
  const minPow = useSettingsStore((s) => s.powFilterDifficulty)

  const [advanced, setAdvanced] = useState<Filter | null>(null)
  const [page, setPage] = useState(1)

  // Reset any advanced query when navigating to a different game.
  useEffect(() => { setAdvanced(null) }, [gameName])

  const baseFilter = useMemo<Filter>(
    () => advanced ?? { kinds: [KINDS.MOD], '#g': [gameName] },
    [advanced, gameName],
  )
  const { mods: newMods, loading, loadingMore, reachedEnd, loadMore } = useProgressiveMods(baseFilter)

  // LEGACY: merge in old kind-30402 mods for this game (matched by game name).
  const legacyMods = useLegacyModsStore((s) => s.mods)
  const legacyLoading = useLegacyModsStore((s) => s.loading)
  useEffect(() => { useLegacyModsStore.getState().load() }, [])
  const mods = useMemo(
    () => withLegacyMods(newMods, legacyMods.filter(m => m.game.toLowerCase() === gameName.toLowerCase())),
    [newMods, legacyMods, gameName],
  )
  // Keep the skeletons until BOTH fetches settle — otherwise legacy mods pop in
  // after the current-mod fetch finishes and the list visibly reflows. Skip the
  // wait when legacy is hidden, since none would be shown anyway.
  const showSkeleton = loading || (legacyMode !== 'hide' && legacyLoading)

  const availableClients = useMemo(
    () => [...new Set(mods.map(m => m.client).filter((c): c is string => !!c))].sort(),
    [mods],
  )

  const moderate = useModerationFilter()
  const blockFilter = useBlockFilter()
  const wotFilter = useWotModFilter()
  const powExempt = useFollowedSet()

  const preWot = useMemo(
    () => blockFilter(moderate(applyModFilters(mods, { nsfwMode, minPow, sources, searchTags, excludedTags, categoryFilters, repostMode, emulationMode, legacyMode, powExempt }))),
    [moderate, blockFilter, mods, nsfwMode, minPow, sources, searchTags, excludedTags, categoryFilters, repostMode, emulationMode, legacyMode, powExempt],
  )
  const filtered = useMemo(() => wotFilter(preWot), [wotFilter, preWot])
  const wotHiddenCount = useWotHiddenCount(preWot)

  const totalPages = Math.max(1, Math.ceil(filtered.length / MODS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * MODS_PER_PAGE, currentPage * MODS_PER_PAGE)

  // Reset to page 1 on filter / query changes.
  useEffect(() => { setPage(1) }, [advanced, gameName, nsfwMode, minPow, sources, searchTags, excludedTags, categoryFilters, repostMode, emulationMode, legacyMode])

  // Prefetch an older batch as the user nears the last loaded page.
  useEffect(() => {
    if (!loading && !reachedEnd && currentPage >= totalPages - 1) loadMore()
  }, [currentPage, totalPages, reachedEnd, loading, loadMore])

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

  return (
    <div className="space-y-8">
      {/* Banner */}
      <div className="relative rounded-xl overflow-hidden">
        {images?.wideImage ? (
          <img
            src={images.wideImage}
            alt={gameName}
            className="w-full h-48 md:h-64 object-cover"
          />
        ) : (
          <div className="w-full h-48 md:h-64 bg-gradient-to-br from-purple-900/40 to-[#171717] flex items-center justify-center">
            <Gamepad2 className="w-16 h-16 text-neutral-700" />
          </div>
        )}

        {/* Overlay with game info */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-[#171717] to-transparent p-6 flex items-end gap-4">
          {images?.boxartImage && (
            <img
              src={images.boxartImage}
              alt={gameName}
              className="w-16 md:w-20 aspect-[2/3] rounded-lg object-cover border-2 border-[#262626]"
            />
          )}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">
              {gameName}
            </h1>
            {!showSkeleton && (
              <p className="text-neutral-400 text-sm mt-1">
                at least {mods.length} {mods.length === 1 ? 'mod' : 'mods'} available
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Mods */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Mods</h2>
          <AdvancedSearch
            fixedGame={gameName}
            active={!!advanced}
            onSearch={setAdvanced}
            onClear={() => setAdvanced(null)}
          />
        </div>

        {advanced && (
          <button
            onClick={() => setAdvanced(null)}
            className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-sm text-purple-300 hover:bg-purple-500/20"
          >
            Advanced search active
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        <ModFiltersBar availableClients={availableClients} resultCount={filtered.length} wotHiddenCount={wotHiddenCount} />

        {showSkeleton ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
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
            {mods.length > 0 ? 'No mods match your filters.' : 'No mods found for this game yet.'}
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
                currentPage <= 1 ? 'text-neutral-600 cursor-not-allowed' : 'text-neutral-400 hover:bg-[#2a2a2a]',
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
                    num === currentPage ? 'bg-purple-600 text-white' : 'text-neutral-400 hover:bg-[#2a2a2a]',
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
                currentPage >= totalPages && reachedEnd ? 'text-neutral-600 cursor-not-allowed' : 'text-neutral-400 hover:bg-[#2a2a2a]',
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
    </div>
  )
}
