import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
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
import { useModFiltersStore } from '@/stores/modFiltersStore' // LEGACY
import { useLegacyModsStore } from '@/stores/legacyModsStore' // LEGACY
import { withLegacyMods } from '@/lib/mods/legacy' // LEGACY
import { useProgressiveEvents } from '@/hooks/useProgressiveEvents'
import { useModerationFilter } from '@/hooks/useModeration'
import type { BlogDetails } from '@/types/blog'
import { ModCard } from '@/components/mod/ModCard'
import { BlogPostCard } from '@/components/blog/BlogPostCard'
import { PublisherCard } from '@/components/mod/PublisherCard'
import { SocialPost } from '@/components/social/SocialPost'
import { Pagination } from '@/components/shared/Pagination'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, User } from 'lucide-react'

const tabTrigger = 'py-1.5 data-[state=active]:bg-[#262626] data-[state=active]:text-purple-400'
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
  const myPubkey = useAuthStore((s) => s.pubkey)
  const [page, setPage] = useState(1)

  // LEGACY: merge in this author's old kind-30402 mods, respecting the global
  // legacy visibility setting (no filter bar on the profile page).
  const legacyMode = useModFiltersStore((s) => s.legacyMode)
  const legacyMods = useLegacyModsStore((s) => s.mods)
  const legacyLoading = useLegacyModsStore((s) => s.loading)
  useEffect(() => { useLegacyModsStore.getState().load() }, [])
  const mods = useMemo(() => {
    const authorLegacy = legacyMode === 'hide' ? [] : legacyMods.filter((m) => m.pubkey === pubkey)
    const base = legacyMode === 'only' ? [] : newMods
    return withLegacyMods(base, authorLegacy)
  }, [newMods, legacyMods, legacyMode, pubkey])

  useEffect(() => { setPage(1) }, [pubkey])

  // Hide admin-moderated mods from discovery — but the author always sees their
  // own (with the "Moderated" badge that ModCard renders).
  const isOwn = myPubkey === pubkey
  const visible = useMemo(() => (isOwn ? mods : moderate(mods)), [isOwn, moderate, mods])

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

  if (showSkeleton) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-lg bg-[#212121]" />)}
      </div>
    )
  }
  if (paged.length === 0) return <p className="text-neutral-500 text-sm text-center py-12">No mods published yet.</p>

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {paged.map((mod) => <ModCard key={mod.aTag} mod={mod} />)}
      </div>
      <Pagination page={current} totalPages={totalPages} onPage={setPage} reachedEnd={reachedEnd} loadingMore={loadingMore} />
    </>
  )
}

// ─── Blogs tab (paginated + progressive) ────────────────────────────────

function BlogsTab({ pubkey, profile }: { pubkey: string; profile: UserProfile | null }) {
  const filter = useMemo<Filter>(() => ({ kinds: [KINDS.BLOG], authors: [pubkey] }), [pubkey])
  const { events, loading, loadingMore, reachedEnd, loadMore } = useProgressiveEvents(filter)
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [pubkey])

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

  const totalPages = Math.max(1, Math.ceil(blogs.length / BLOGS_PER_PAGE))
  const current = Math.min(page, totalPages)
  const paged = blogs.slice((current - 1) * BLOGS_PER_PAGE, current * BLOGS_PER_PAGE)

  useEffect(() => {
    if (!loading && !reachedEnd && current >= totalPages - 1) loadMore()
  }, [current, totalPages, reachedEnd, loading, loadMore])

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg bg-[#212121]" />)}
      </div>
    )
  }
  if (paged.length === 0) return <p className="text-neutral-500 text-sm text-center py-12">No blog posts published yet.</p>

  return (
    <>
      <div className="space-y-4">
        {paged.map((blog) => <BlogPostCard key={blog.id} blog={blog} author={profile ?? undefined} />)}
      </div>
      <Pagination page={current} totalPages={totalPages} onPage={setPage} reachedEnd={reachedEnd} loadingMore={loadingMore} />
    </>
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
