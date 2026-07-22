import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { nip19, type Filter } from 'nostr-tools'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { useSeoMeta } from '@/hooks/useSeoMeta'
import { useDnnStore } from '@/stores/dnnStore'
import { dnnService } from '@/lib/dnn/dnnService'
import { isValidDnnFormat } from '@/lib/dnn/dnnUtils'
import { formatDnnId } from '@/lib/dnn/formatDnnId'
import { KINDS } from '@/lib/constants'
import { extractBlogData } from '@/lib/nostr/events'
import { useProgressiveMods } from '@/hooks/useProgressiveMods'
import { useProfileModFiltersStore } from '@/stores/modFiltersStore'
import { useLegacyModsStore } from '@/stores/legacyModsStore' // LEGACY
import { withLegacyMods } from '@/lib/mods/legacy' // LEGACY
import { useProgressiveEvents } from '@/hooks/useProgressiveEvents'
import { useModerationFilter } from '@/hooks/useModeration'
import { useBlockFilter } from '@/hooks/useBlock'
import { useWotModFilter, useWotHiddenCount } from '@/hooks/useWot'
import { useFollowedSet } from '@/hooks/useFollowedSet'
import { applyModFilters } from '@/lib/mods/filterMods'
import { ModFiltersBar, TagEditor, SourcesEditor } from '@/components/search/ModFiltersBar'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { UNTAGGED, BUILTIN_SOURCES, type NsfwMode, type SourceEntry } from '@/stores/modFiltersStore'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { SearchBar } from '@/components/search/SearchBar'
import { cn } from '@/lib/utils'
import type { BlogDetails } from '@/types/blog'
import { ModCard } from '@/components/mod/ModCard'
import { BlogPostCard } from '@/components/blog/BlogPostCard'
import { PublisherCard } from '@/components/mod/PublisherCard'
import { SocialPost } from '@/components/social/SocialPost'
import { Pagination } from '@/components/shared/Pagination'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, User, Tag as TagIcon, ChevronDown, Radio, Users } from 'lucide-react'

const tabTrigger = 'py-1.5 data-[state=active]:bg-[#262626] data-[state=active]:text-purple-400'

const BLOG_NSFW_OPTIONS: { value: NsfwMode; label: string }[] = [
  { value: 'hide', label: 'Hide NSFW' },
  { value: 'show', label: 'Show NSFW' },
  { value: 'only', label: 'Only NSFW' },
]

/**
 * Sources start all-enabled, including untagged.
 *
 * The mods listing defaults `untagged` off, because an untagged mod there is
 * usually one scraped in from elsewhere. A blog post carries a client tag only
 * if the writing app set one, and most long-form clients don't — defaulting it
 * off would hide the majority of a non-DEG-Mods author's posts by default.
 */
const DEFAULT_BLOG_SOURCES: SourceEntry[] = [
  ...BUILTIN_SOURCES.map((name) => ({ name, enabled: true })),
  { name: UNTAGGED, enabled: true },
]
const hideInactive = 'mt-4 data-[state=inactive]:hidden'

const MODS_PER_PAGE = 12
const BLOGS_PER_PAGE = 8

export default function ProfilePage() {
  const { npub } = useParams<{ npub: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = ['mods', 'blogs', 'social'].includes(searchParams.get('tab') ?? '')
    ? searchParams.get('tab')!
    : 'mods'
  const setTab = (v: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', v)
    setSearchParams(next, { replace: true })
  }
  const { pubkey: authedPubkey } = useAuthStore()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [targetPubkey, setTargetPubkey] = useState<string | null>(null)
  const targetPubkeyRef = useRef<string | null>(null)
  targetPubkeyRef.current = targetPubkey

  // Resolve the URL param — an npub, a DNN ID, or a hex pubkey.
  useEffect(() => {
    if (!npub) {
      if (authedPubkey) navigate(`/profile/${nip19.npubEncode(authedPubkey)}`, { replace: true })
      return
    }
    let cancelled = false
    if (npub.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(npub)
        setTargetPubkey(decoded.type === 'npub' ? (decoded.data as string) : null)
      } catch {
        setTargetPubkey(null)
      }
    } else if (isValidDnnFormat(npub)) {
      // If this DNN ID already belongs to the loaded profile (e.g. we just
      // hot-swapped the URL), keep it — don't reset/refetch.
      const cur = targetPubkeyRef.current
      const curDnn = cur ? useDnnStore.getState().getVerifiedDnnId(cur) : null
      if (curDnn && formatDnnId(curDnn).toLowerCase() === npub.toLowerCase()) return
      setTargetPubkey(null)
      ;(async () => {
        await useDnnStore.getState().initService()
        const res = await dnnService.resolve(npub)
        if (cancelled) return
        if (res?.npub) {
          try { setTargetPubkey(nip19.decode(res.npub).data as string) } catch { setTargetPubkey(null) }
        } else setTargetPubkey(null)
      })()
    } else if (/^[0-9a-f]{64}$/i.test(npub)) {
      setTargetPubkey(npub.toLowerCase())
    } else {
      setTargetPubkey(null)
    }
    return () => { cancelled = true }
  }, [npub, authedPubkey, navigate])

  // Fetch profile + verify any DNN ID.
  useEffect(() => {
    if (!targetPubkey) return
    let cancelled = false
    async function load() {
      const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      setProfileLoading(true)
      try {
        const p = await useUserStore.getState().fetchProfile(targetPubkey!, relayUrls)
        if (cancelled) return
        setProfile(p)
        useDnnStore.getState().verifyPubkey(targetPubkey!, p?.nip05 as string | undefined)
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [targetPubkey])

  // Hot-swap the URL to the DNN ID once it's verified (when arrived via npub).
  const verifiedDnnId = useDnnStore((s) => (targetPubkey ? s.getVerifiedDnnId(targetPubkey) : null))
  useEffect(() => {
    if (targetPubkey && verifiedDnnId && npub?.startsWith('npub1')) {
      navigate(`/profile/${formatDnnId(verifiedDnnId)}`, { replace: true })
    }
  }, [targetPubkey, verifiedDnnId, npub, navigate])

  useSeoMeta(profile ? {
    title: profile.display_name || profile.name || (npub ? `${npub.slice(0, 12)}…` : 'Profile'),
    description: profile.about,
    image: profile.picture,
    type: 'profile',
  } : null)

  if (!targetPubkey && !npub) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <User className="h-12 w-12 text-neutral-500" />
        <h2 className="text-xl font-semibold text-neutral-200">No profile selected</h2>
        <p className="text-neutral-400 text-sm">Log in to view your profile.</p>
        <Button variant="outline" onClick={() => useLoginModalStore.getState().open()}>Log In</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column: tabbed posts */}
        <div className="lg:col-span-2 min-w-0">
          {targetPubkey ? (
            <Tabs value={tab} onValueChange={setTab} className="w-full">
              <TabsList className="grid h-auto w-full grid-cols-3 items-stretch bg-[#1c1c1c] border border-[#262626]">
                <TabsTrigger value="mods" className={tabTrigger}>Mods</TabsTrigger>
                <TabsTrigger value="blogs" className={tabTrigger}>Blog</TabsTrigger>
                <TabsTrigger value="social" className={tabTrigger}>Social</TabsTrigger>
              </TabsList>

              <TabsContent value="mods" forceMount className={hideInactive}>
                <ModsTab pubkey={targetPubkey} />
              </TabsContent>
              <TabsContent value="blogs" forceMount className={hideInactive}>
                <BlogsTab pubkey={targetPubkey} profile={profile} />
              </TabsContent>
              <TabsContent value="social" forceMount className={hideInactive}>
                <SocialTab pubkey={targetPubkey} />
              </TabsContent>
            </Tabs>
          ) : (
            <Skeleton className="h-10 w-full rounded-lg bg-[#212121]" />
          )}
        </div>

        {/* Right column: author card */}
        <div className="lg:sticky lg:top-20 self-start">
          {targetPubkey && !profileLoading ? (
            <PublisherCard pubkey={targetPubkey} />
          ) : (
            <div className="overflow-hidden rounded-lg bg-[#1c1c1c]">
              <Skeleton className="h-35 w-full rounded-none bg-[#212121]" />
              <div className="px-4 pb-4">
                <Skeleton className="-mt-8 h-16 w-16 rounded-full bg-[#212121] ring-4 ring-[#1c1c1c]" />
                <Skeleton className="mt-3 h-4 w-32 bg-[#212121]" />
                <Skeleton className="mt-2 h-3 w-24 bg-[#212121]" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Mods tab (paginated + progressive) ─────────────────────────────────

function ModsTab({ pubkey }: { pubkey: string }) {
  const filter = useMemo<Filter>(() => ({ kinds: [KINDS.MOD], authors: [pubkey] }), [pubkey])
  const { mods: newMods, loading, loadingMore, reachedEnd, loadMore } = useProgressiveMods(filter)
  const moderate = useModerationFilter()
  const blockFilter = useBlockFilter()
  const wotFilter = useWotModFilter()
  const powExempt = useFollowedSet()
  const myPubkey = useAuthStore((s) => s.pubkey)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')

  // Profile-scoped filters, so narrowing this author's mods doesn't reshape /mods.
  const {
    nsfwMode, sources, searchTags, excludedTags, categoryFilters,
    repostMode, emulationMode, legacyMode,
  } = useProfileModFiltersStore()
  const minPow = useSettingsStore((s) => s.powFilterDifficulty)

  // LEGACY: merge in this author's old kind-30402 mods.
  const legacyMods = useLegacyModsStore((s) => s.mods)
  const legacyLoading = useLegacyModsStore((s) => s.loading)
  useEffect(() => { useLegacyModsStore.getState().load() }, [])
  const mods = useMemo(
    () => withLegacyMods(newMods, legacyMods.filter((m) => m.pubkey === pubkey)),
    [newMods, legacyMods, pubkey],
  )

  useEffect(() => { setPage(1) }, [pubkey])

  const availableClients = useMemo(
    () => [...new Set(mods.map((m) => m.client).filter((c): c is string => !!c))].sort(),
    [mods],
  )

  // Hide admin-moderated mods from discovery — but the author always sees their
  // own (with the "Moderated" badge that ModCard renders).
  const isOwn = myPubkey === pubkey
  const preWot = useMemo(() => {
    const filtered = applyModFilters(mods, {
      nsfwMode, minPow, sources, searchTags, excludedTags, categoryFilters,
      repostMode, emulationMode, legacyMode, powExempt,
    })
    const moderated = isOwn ? filtered : moderate(filtered)
    const unblocked = blockFilter(moderated)
    if (!search.trim()) return unblocked
    const q = search.toLowerCase()
    return unblocked.filter((m) =>
      m.title.toLowerCase().includes(q) ||
      m.game.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }, [mods, isOwn, moderate, blockFilter, search, nsfwMode, minPow, sources, searchTags,
      excludedTags, categoryFilters, repostMode, emulationMode, legacyMode, powExempt])

  const visible = useMemo(() => wotFilter(preWot), [wotFilter, preWot])
  const wotHiddenCount = useWotHiddenCount(preWot)

  // Filters change what's on screen, so an out-of-range page would look empty.
  useEffect(() => { setPage(1) }, [search, nsfwMode, minPow, sources, searchTags,
    excludedTags, categoryFilters, repostMode, emulationMode, legacyMode])

  const totalPages = Math.max(1, Math.ceil(visible.length / MODS_PER_PAGE))
  const current = Math.min(page, totalPages)
  const paged = visible.slice((current - 1) * MODS_PER_PAGE, current * MODS_PER_PAGE)

  useEffect(() => {
    if (!loading && !reachedEnd && current >= totalPages - 1) loadMore()
  }, [current, totalPages, reachedEnd, loading, loadMore])

  // Hold the skeletons until BOTH the current-mod and legacy fetches settle so
  // this author's legacy mods don't pop in after the fact. Skip the wait when
  // legacy is hidden, since none would be shown.
  const showSkeleton = loading || (legacyMode !== 'hide' && legacyLoading)

  // The filters stay mounted through loading and empty states — they're how you
  // get out of an empty state you filtered yourself into.
  const controls = (
    <div className="space-y-3">
      <SearchBar value={search} onChange={setSearch} placeholder="Search this author's mods by title, game, or tags…" />
      <ModFiltersBar
        availableClients={availableClients}
        resultCount={visible.length}
        wotHiddenCount={wotHiddenCount}
        store={useProfileModFiltersStore}
      />
    </div>
  )

  if (showSkeleton) {
    return (
      <div className="space-y-4">
        {controls}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-lg bg-[#212121]" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {controls}
      {paged.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">
          {mods.length === 0 ? 'No mods published yet.' : 'No mods match your filters.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {paged.map((mod) => <ModCard key={mod.aTag} mod={mod} />)}
          </div>
          <Pagination page={current} totalPages={totalPages} onPage={setPage} reachedEnd={reachedEnd} loadingMore={loadingMore} />
        </>
      )}
    </div>
  )
}

// ─── Blogs tab (paginated + progressive) ────────────────────────────────

function BlogsTab({ pubkey, profile }: { pubkey: string; profile: UserProfile | null }) {
  const filter = useMemo<Filter>(() => ({ kinds: [KINDS.BLOG], authors: [pubkey] }), [pubkey])
  const { events, loading, loadingMore, reachedEnd, loadMore } = useProgressiveEvents(filter)
  const [page, setPage] = useState(1)
  // Lighter than the mods bar: categories, reposts, emulation and the legacy
  // variant have no blog equivalent, so those controls would be inert. NSFW,
  // sources and moderation do apply and are here. Order is deliberately absent —
  // posts are always newest-first, the only order a blog listing wants.
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [tagsOpen, setTagsOpen] = useState(false)
  const [nsfwMode, setNsfwMode] = useState<NsfwMode>('hide')
  const [sources, setSources] = useState<SourceEntry[]>(DEFAULT_BLOG_SOURCES)
  const [sourcesOpen, setSourcesOpen] = useState(false)

  // Admin-hidden posts and blocked authors, honoring the reader's opt-out.
  const moderate = useModerationFilter()
  const softOn = usePreferencesStore((s) => s.softModeration)

  useEffect(() => { setPage(1) }, [pubkey])
  useEffect(() => { setPage(1) }, [search, tagFilter, nsfwMode, sources])

  const blogs = useMemo<BlogDetails[]>(() => {
    const byKey = new Map<string, typeof events[number]>()
    for (const ev of events) {
      const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
      const key = `${ev.pubkey}:${d}`
      const existing = byKey.get(key)
      if (!existing || ev.created_at > existing.created_at) byKey.set(key, ev)
    }
    return Array.from(byKey.values())
      .map(extractBlogData)
      .filter((b) => !b.isDeleted)
      .sort((a, b) => b.publishedAt - a.publishedAt)
  }, [events])

  /** Client names seen on this author's posts, for the Sources picker. */
  const availableClients = useMemo(
    () => [...new Set(blogs.map((b) => b.client).filter((c): c is string => !!c))],
    [blogs],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const wanted = tagFilter.map((t) => t.toLowerCase())
    const disabledSources = new Set(sources.filter((s) => !s.enabled).map((s) => s.name.toLowerCase()))
    return moderate(blogs).filter((b) => {
      if (nsfwMode === 'hide' && b.contentWarning) return false
      if (nsfwMode === 'only' && !b.contentWarning) return false
      if (disabledSources.size && disabledSources.has((b.client || UNTAGGED).toLowerCase())) return false
      if (wanted.length && !b.tags.some((t) => wanted.includes(t.toLowerCase()))) return false
      if (!q) return true
      return b.title.toLowerCase().includes(q) ||
        b.summary.toLowerCase().includes(q) ||
        b.tags.some((t) => t.toLowerCase().includes(q))
    })
  }, [blogs, search, tagFilter, nsfwMode, sources, moderate])

  const totalPages = Math.max(1, Math.ceil(visible.length / BLOGS_PER_PAGE))
  const current = Math.min(page, totalPages)
  const paged = visible.slice((current - 1) * BLOGS_PER_PAGE, current * BLOGS_PER_PAGE)

  useEffect(() => {
    if (!loading && !reachedEnd && current >= totalPages - 1) loadMore()
  }, [current, totalPages, reachedEnd, loading, loadMore])

  const controls = (
    <div className="space-y-3">
      <SearchBar value={search} onChange={setSearch} placeholder="Search this author's posts by title, summary, or tags…" />
      <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="group inline-flex items-center gap-1.5 rounded-lg border border-[#262626] bg-[#1c1c1c] px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-[#404040] focus:outline-none">
                {BLOG_NSFW_OPTIONS.find((o) => o.value === nsfwMode)?.label}
                <ChevronDown className="h-4 w-4 text-neutral-400 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-[#262626] bg-[#1c1c1c]">
              {BLOG_NSFW_OPTIONS.map((o) => (
                <DropdownMenuItem
                  key={o.value}
                  onClick={() => setNsfwMode(o.value)}
                  className={cn('cursor-pointer text-sm', nsfwMode === o.value ? 'text-purple-300' : 'text-neutral-300')}
                >
                  {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={() => setTagsOpen(true)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
              tagFilter.length
                ? 'border-purple-500/40 bg-purple-500/10 text-purple-300'
                : 'border-[#262626] text-neutral-300 hover:border-[#404040]',
            )}
          >
            <TagIcon className="h-4 w-4" /> Tags
            {tagFilter.length > 0 && <span className="text-xs tabular-nums opacity-70">{tagFilter.length}</span>}
          </button>
          <button
            onClick={() => setSourcesOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-[#404040]"
          >
            <Radio className="h-4 w-4" /> Sources
            <span className="text-xs tabular-nums opacity-70">{sources.filter((s) => s.enabled).length}</span>
          </button>
          {/* Reflects the global soft-moderation setting rather than owning a
              local copy — one switch, configured in Settings, same as /mods. */}
          <Link
            to="/settings?tab=moderation"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-[#404040]"
          >
            <Users className="h-4 w-4" /> {softOn ? 'Moderated' : 'Unmoderated'}
          </Link>
          <span className="ml-auto text-sm text-neutral-500">
            {visible.length} {visible.length === 1 ? 'post' : 'posts'}
          </span>
        </div>
      </div>

      <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Sources</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Show only posts published by these clients.
            </DialogDescription>
          </DialogHeader>
          <SourcesEditor sources={sources} onChange={setSources} availableClients={availableClients} />
        </DialogContent>
      </Dialog>

      <Dialog open={tagsOpen} onOpenChange={setTagsOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Filter by tags</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Show only posts carrying at least one of these tags.
            </DialogDescription>
          </DialogHeader>
          <TagEditor tags={tagFilter} onChange={setTagFilter} placeholder="Add a tag…" />
        </DialogContent>
      </Dialog>
    </div>
  )

  if (loading) {
    return (
      <div className="space-y-4">
        {controls}
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg bg-[#212121]" />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {controls}
      {paged.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">
          {blogs.length === 0 ? 'No blog posts published yet.' : 'No posts match your filters.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4">
            {paged.map((blog) => <BlogPostCard key={blog.id} blog={blog} author={profile ?? undefined} />)}
          </div>
          <Pagination page={current} totalPages={totalPages} onPage={setPage} reachedEnd={reachedEnd} loadingMore={loadingMore} />
        </>
      )}
    </div>
  )
}

// ─── Social tab (infinite scroll) ───────────────────────────────────────

function SocialTab({ pubkey }: { pubkey: string }) {
  const filter = useMemo<Filter>(() => ({ kinds: [KINDS.SHORT_NOTE], authors: [pubkey] }), [pubkey])
  const { events, loading, loadingMore, reachedEnd, loadMore } = useProgressiveEvents(filter)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Load more as the bottom sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || reachedEnd) return
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore() },
      { rootMargin: '400px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [reachedEnd, loadMore, events.length])

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg bg-[#212121]" />)}
      </div>
    )
  }
  if (events.length === 0) return <p className="text-neutral-500 text-sm text-center py-12">No posts yet.</p>

  return (
    <div className="space-y-3">
      {events.map((note) => <SocialPost key={note.id} note={note} />)}

      {!reachedEnd && <div ref={sentinelRef} className="h-1" />}
      {loadingMore && (
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading more…
        </div>
      )}
    </div>
  )
}
