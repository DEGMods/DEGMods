import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Filter } from 'nostr-tools'
import { Search, Plus, X } from 'lucide-react'
import { KINDS } from '@/lib/constants'
import { useProgressiveEvents } from '@/hooks/useProgressiveEvents'
import { constructBountyListFromEvents, MOD_BOUNTY_TYPE } from '@/lib/nostr/bounty'
import { applyBountyFilters } from '@/lib/nostr/filterBounties'
import { useBountyFiltersStore } from '@/stores/bountyFiltersStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useModerationStore } from '@/stores/moderationStore'
import { useModerationFilter } from '@/hooks/useModeration'
import { useBlockFilter } from '@/hooks/useBlock'
import { useWotJamFilter, useWotHiddenCount } from '@/hooks/useWot'
import { useFollowedSet } from '@/hooks/useFollowedSet'
import { useSeoMeta } from '@/hooks/useSeoMeta'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BountyCard } from '@/components/mod/BountyCard'
import { BountyFiltersBar } from '@/components/mod/BountyFiltersBar'
import { AdvancedSearch } from '@/components/search/AdvancedSearch'
import { Pagination } from '@/components/shared/Pagination'

const BATCH = 60
const PER_PAGE = 20

export function BountiesPage() {
  useSeoMeta({ title: 'Mod Requests', description: 'Requested mods people want, for the games they play.' })

  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [advanced, setAdvanced] = useState<Filter | null>(null)
  const [page, setPage] = useState(1)

  const { nsfwMode, status, game, sources, searchTags, excludedTags, setGame } = useBountyFiltersStore()
  const minPow = useSettingsStore((s) => s.powFilterDifficulty)
  const moderationDefaults = useModerationStore((s) => s.excludedTags)
  const powExempt = useFollowedSet()
  const moderate = useModerationFilter()
  const blockFilter = useBlockFilter()
  const wotFilter = useWotJamFilter()

  // Deep link: /mod-requests?game=<name> pins the game filter (from a game page).
  useEffect(() => {
    const g = searchParams.get('game')
    if (g) setGame(g)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Track the admin moderation defaults for excluded tags until the user edits them.
  useEffect(() => {
    useBountyFiltersStore.getState().applyExcludedTagsDefaults(moderationDefaults)
  }, [moderationDefaults])

  // Advanced (relay-side) search replaces the default listing query; it stays
  // scoped to game-mod requests via the `#b` base so it can't escape the kind.
  const filter = useMemo<Filter>(() => advanced ?? { kinds: [KINDS.BOUNTY], '#b': [MOD_BOUNTY_TYPE] }, [advanced])
  const { events, loading, loadingMore, reachedEnd, loadMore } = useProgressiveEvents(filter, BATCH)
  const bounties = useMemo(() => constructBountyListFromEvents(events), [events])

  const availableClients = useMemo(
    () => [...new Set(bounties.map((b) => b.client).filter(Boolean))].sort(),
    [bounties],
  )

  const preWot = useMemo(() => {
    let list = blockFilter(moderate(applyBountyFilters(bounties, {
      nsfwMode, status, game, minPow, sources, searchTags, excludedTags, powExempt,
    })))
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((b) =>
      b.title.toLowerCase().includes(q) ||
      b.game.toLowerCase().includes(q) ||
      b.tags.some((t) => t.toLowerCase().includes(q)),
    )
    return list
  }, [bounties, moderate, blockFilter, nsfwMode, status, game, minPow, sources, searchTags, excludedTags, powExempt, search])

  const filtered = useMemo(
    () => wotFilter(preWot).sort((a, b) => b.publishedAt - a.publishedAt),
    [wotFilter, preWot],
  )
  const wotHiddenCount = useWotHiddenCount(preWot)

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE)

  // Reset to page 1 whenever the filters change the result set.
  useEffect(() => { setPage(1) }, [nsfwMode, status, game, sources, searchTags, excludedTags, search, advanced])

  // Prefetch an older batch as the user nears the last loaded page.
  useEffect(() => {
    if (!loading && !reachedEnd && currentPage >= totalPages - 1) loadMore()
  }, [currentPage, totalPages, reachedEnd, loading, loadMore])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Mod Requests</h1>
        <Link to="/submit-mod-request">
          <Button size="sm" className="gap-1.5 bg-orange-600 text-xs text-white hover:bg-orange-700">
            <Plus size={14} /> Post request
          </Button>
        </Link>
      </div>

      {advanced && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setAdvanced(null)}
            className="inline-flex items-center gap-1.5 rounded-md border border-orange-500/30 bg-orange-500/10 px-2.5 py-1 text-sm text-orange-300 hover:bg-orange-500/20"
          >
            Advanced search active
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Quick local search by title, game, or tags..." className="border-[#262626] bg-[#212121] pl-9 text-white" />
        </div>
        <AdvancedSearch
          kind={KINDS.BOUNTY}
          base={{ '#b': [MOD_BOUNTY_TYPE] }}
          showCategories={false}
          subject="mod request"
          accent="orange"
          active={!!advanced}
          onSearch={setAdvanced}
          onClear={() => setAdvanced(null)}
        />
      </div>

      <BountyFiltersBar availableClients={availableClients} resultCount={filtered.length} wotHiddenCount={wotHiddenCount} />

      {loading && bounties.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">Loading mod requests...</p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">No mod requests match these filters.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {paginated.map((b) => <BountyCard key={b.aTag} bounty={b} />)}
          </div>
          <Pagination page={currentPage} totalPages={totalPages} onPage={setPage} reachedEnd={reachedEnd} loadingMore={loadingMore} />
        </>
      )}
    </div>
  )
}

