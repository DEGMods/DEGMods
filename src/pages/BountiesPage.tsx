import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Filter } from 'nostr-tools'
import { Search, Plus, Gamepad2, CheckCircle2, CircleDashed, Gift, AlertTriangle, User, X } from 'lucide-react'
import { KINDS } from '@/lib/constants'
import { useProgressiveEvents } from '@/hooks/useProgressiveEvents'
import { constructBountyListFromEvents, MOD_BOUNTY_TYPE, type BountyDetails } from '@/lib/nostr/bounty'
import { applyBountyFilters } from '@/lib/nostr/filterBounties'
import { useBountyFiltersStore } from '@/stores/bountyFiltersStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useModerationStore } from '@/stores/moderationStore'
import { useModerationFilter } from '@/hooks/useModeration'
import { useBlockFilter } from '@/hooks/useBlock'
import { useWotJamFilter, useWotHiddenCount } from '@/hooks/useWot'
import { useFollowedSet } from '@/hooks/useFollowedSet'
import { useNsfwReveal } from '@/hooks/useNsfwReveal'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { useSeoMeta } from '@/hooks/useSeoMeta'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { BountyFiltersBar } from '@/components/mod/BountyFiltersBar'
import { AdvancedSearch } from '@/components/search/AdvancedSearch'
import { Pagination } from '@/components/shared/Pagination'
import { cn } from '@/lib/utils'

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
        <Link to="/submit-mod-bounty">
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

function BountyCard({ bounty: b }: { bounty: BountyDetails }) {
  const { revealed, reveal } = useNsfwReveal()
  const [author, setAuthor] = useState<UserProfile | null>(null)
  const hasWarning = !!b.contentWarning && !revealed

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(b.pubkey, relays).then((p) => { if (!cancelled) setAuthor(p) })
    return () => { cancelled = true }
  }, [b.pubkey])

  const authorName = author?.display_name || `${b.pubkey.slice(0, 8)}…`

  return (
    <Link to={`/mod-bounty/${b.naddr}`} className="group block h-full">
      {/* Orange gradient border, shown on hover */}
      <div className="relative h-full rounded-lg p-0.5">
        <div className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-t from-orange-500 to-transparent to-50% opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <Card className="relative flex h-full flex-col overflow-hidden rounded-md border-0 bg-[#1c1c1c]">
          <div className="relative aspect-video overflow-hidden">
            {b.image ? (
              <SkeletonImage src={b.image} alt={b.title} className={cn('absolute inset-0 h-full w-full object-cover', hasWarning && 'blur-xl')} />
            ) : (
              <img src="/hub-banner-placeholder.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}

            {hasWarning && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); reveal() }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/60 text-neutral-300"
              >
                <AlertTriangle className="h-6 w-6 text-yellow-500" />
                <span className="px-3 text-center text-xs font-medium">{b.contentWarning}</span>
                <span className="text-[10px] text-neutral-500">Click to reveal</span>
              </button>
            )}

            {/* Status pill */}
            <span className={cn('absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm', b.fulfilled ? 'text-emerald-400' : 'text-amber-400')}>
              {b.fulfilled ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
              {b.fulfilled ? 'Fulfilled' : 'Open'}
            </span>
          </div>

          <div className="flex flex-1 flex-col p-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-orange-400">
                <Gamepad2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{b.game}</span>
              </div>

              <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white">{b.title}</h3>
              {b.summary && <p className="line-clamp-2 text-sm leading-relaxed text-neutral-400">{b.summary}</p>}

              {b.reward && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-300">
                  <Gift className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{b.reward.what}{b.reward.how ? ` (${b.reward.how})` : ''}</span>
                </p>
              )}
            </div>

            <div className="mt-3 flex min-w-0 items-center gap-2 border-t border-[#262626] pt-3">
              <Avatar className="h-5 w-5 shrink-0">
                {author?.picture ? <AvatarImage src={author.picture} alt={authorName} /> : null}
                <AvatarFallback className="bg-[#212121] text-neutral-400"><User className="h-3 w-3" /></AvatarFallback>
              </Avatar>
              <span className="truncate text-xs text-neutral-400">{authorName}</span>
            </div>
          </div>
        </Card>
      </div>
    </Link>
  )
}
