import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Filter } from 'nostr-tools'
import { Search, Plus, Gamepad2, CheckCircle2, CircleDashed, Gift, PackagePlus } from 'lucide-react'
import { KINDS } from '@/lib/constants'
import { useProgressiveEvents } from '@/hooks/useProgressiveEvents'
import { constructBountyListFromEvents, type BountyDetails } from '@/lib/nostr/bounty'
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
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { BountyFiltersBar } from '@/components/mod/BountyFiltersBar'
import { Pagination } from '@/components/shared/Pagination'
import { cn } from '@/lib/utils'

const BATCH = 60
const PER_PAGE = 20

export function BountiesPage() {
  useSeoMeta({ title: 'Mod Requests', description: 'Requested mods people want, for the games they play.' })

  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { nsfwMode, status, game, sources, searchTags, excludedTags, setGame } = useBountyFiltersStore()
  const minPow = useSettingsStore((s) => s.powFilterDifficulty)
  const moderationDefaults = useModerationStore((s) => s.excludedTags)
  const powExempt = useFollowedSet()
  const moderate = useModerationFilter()
  const blockFilter = useBlockFilter()
  const wotFilter = useWotJamFilter()

  // Deep link: /mod-bounties?game=<name> pins the game filter (from a game page).
  useEffect(() => {
    const g = searchParams.get('game')
    if (g) setGame(g)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Track the admin moderation defaults for excluded tags until the user edits them.
  useEffect(() => {
    useBountyFiltersStore.getState().applyExcludedTagsDefaults(moderationDefaults)
  }, [moderationDefaults])

  const filter = useMemo<Filter>(() => ({ kinds: [KINDS.BOUNTY] }), [])
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
  useEffect(() => { setPage(1) }, [nsfwMode, status, game, sources, searchTags, excludedTags, search])

  // Prefetch an older batch as the user nears the last loaded page.
  useEffect(() => {
    if (!loading && !reachedEnd && currentPage >= totalPages - 1) loadMore()
  }, [currentPage, totalPages, reachedEnd, loading, loadMore])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Mod Requests</h1>
        <Link to="/submit-mod-bounty">
          <Button size="sm" className="gap-1.5 bg-purple-600 text-xs text-white hover:bg-purple-700">
            <Plus size={14} /> Post request
          </Button>
        </Link>
      </div>

      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search requests..." className="border-[#262626] bg-[#212121] pl-9 text-white" />
      </div>

      <BountyFiltersBar availableClients={availableClients} resultCount={filtered.length} wotHiddenCount={wotHiddenCount} />

      {loading && bounties.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">Loading mod requests...</p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">No mod requests match these filters.</p>
      ) : (
        <>
          <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {paginated.map((b) => <BountyCard key={b.aTag} bounty={b} />)}
          </ol>
          <Pagination page={currentPage} totalPages={totalPages} onPage={setPage} reachedEnd={reachedEnd} loadingMore={loadingMore} />
        </>
      )}
    </div>
  )
}

function BountyCard({ bounty: b }: { bounty: BountyDetails }) {
  const nsfw = !!b.contentWarning
  return (
    <li className="flex h-full flex-col overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c] transition-colors hover:border-[#3a3a3a]">
      <Link to={`/mod-bounty/${b.naddr}`} className="flex h-full flex-col">
        <div className="relative aspect-video w-full overflow-hidden bg-[#212121]">
          {b.image ? (
            <SkeletonImage src={b.image} alt={b.title} className={cn('absolute inset-0 h-full w-full object-cover', nsfw && 'blur-xl')} />
          ) : (
            <div className="flex h-full w-full items-center justify-center"><PackagePlus className="h-8 w-8 text-neutral-700" /></div>
          )}
          {nsfw && <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-yellow-400 backdrop-blur">NSFW</span>}
          <span className={cn('absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium backdrop-blur', b.fulfilled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300')}>
            {b.fulfilled ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
            {b.fulfilled ? 'Fulfilled' : 'Open'}
          </span>
        </div>
        <div className="flex flex-1 flex-col p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-400">
            <Gamepad2 className="h-3.5 w-3.5" /> <span className="truncate">{b.game}</span>
          </div>
          <h2 className="text-base font-semibold text-neutral-100">{b.title}</h2>
          {b.summary && <p className="mt-1 line-clamp-2 text-sm text-neutral-400">{b.summary}</p>}
          {b.reward && (
            <p className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-emerald-300">
              <Gift className="h-3.5 w-3.5" /> <span className="truncate">{b.reward.what}{b.reward.how ? ` (${b.reward.how})` : ''}</span>
            </p>
          )}
        </div>
      </Link>
    </li>
  )
}
