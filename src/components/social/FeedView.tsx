import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { nip19, type Filter, type Event as NostrEvent } from 'nostr-tools'
import { Repeat2, Loader2, User, Package, BookOpen, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { KINDS } from '@/lib/constants'
import { extractBlogData } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { useProgressiveMods } from '@/hooks/useProgressiveMods'
import { useProgressiveEvents } from '@/hooks/useProgressiveEvents'
import { useModerationFilter } from '@/hooks/useModeration'
import { useBlockFilter } from '@/hooks/useBlock'
import { useBlockStore } from '@/stores/blockStore'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { classifyPost, parseRepostInner } from '@/lib/nostr/socialThread'
import type { BlogDetails } from '@/types/blog'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { ModCard } from '@/components/mod/ModCard'
import { BlogPostCard } from '@/components/blog/BlogPostCard'
import { ComposePost } from './ComposePost'
import { SocialPost } from './SocialPost'
import { EmbeddedNote } from './EmbeddedNote'

const tabTrigger = 'py-1.5 data-[state=active]:bg-[#262626] data-[state=active]:text-purple-400'

// Infinite-scroll sentinel: calls loadMore when scrolled near the bottom.
function useInfiniteScroll(reachedEnd: boolean, loadMore: () => void, dep: number) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || reachedEnd) return
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore() },
      { rootMargin: '500px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [reachedEnd, loadMore, dep])
  return sentinelRef
}

function LoadingMore() {
  return (
    <div className="flex items-center justify-center gap-2 py-3 text-sm text-neutral-500">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading more…
    </div>
  )
}

// ─── Mods from follows ──────────────────────────────────────────────────

function FeedModsTab({ authors }: { authors: string[] }) {
  const filter = useMemo<Filter>(() => ({ kinds: [KINDS.MOD], authors }), [authors.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const { mods, loading, loadingMore, reachedEnd, loadMore } = useProgressiveMods(filter, 60)
  const moderate = useModerationFilter()
  const blockFilter = useBlockFilter()

  const visible = useMemo(() => blockFilter(moderate(mods)), [blockFilter, moderate, mods])
  const sentinelRef = useInfiniteScroll(reachedEnd, loadMore, visible.length)

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-lg bg-[#212121]" />)}
      </div>
    )
  }
  if (visible.length === 0) return <p className="text-neutral-500 text-sm text-center py-12">No mods from people you follow.</p>

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {visible.map((mod) => <ModCard key={mod.aTag} mod={mod} />)}
      </div>
      {!reachedEnd && <div ref={sentinelRef} className="h-1" />}
      {loadingMore && <LoadingMore />}
    </>
  )
}

// ─── Blogs from follows ─────────────────────────────────────────────────

function FeedBlogsTab({ authors }: { authors: string[] }) {
  const filter = useMemo<Filter>(() => ({ kinds: [KINDS.BLOG], authors }), [authors.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const { events, loading, loadingMore, reachedEnd, loadMore } = useProgressiveEvents(filter, 60)
  const blocked = useBlockStore((s) => s.blockedPubkeys)

  const blogs = useMemo<BlogDetails[]>(() => {
    const byKey = new Map<string, NostrEvent>()
    for (const ev of events) {
      if (blocked.has(ev.pubkey)) continue
      const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
      const key = `${ev.pubkey}:${d}`
      const existing = byKey.get(key)
      if (!existing || ev.created_at > existing.created_at) byKey.set(key, ev)
    }
    return Array.from(byKey.values()).map(extractBlogData).filter((b) => !b.isDeleted).sort((a, b) => b.publishedAt - a.publishedAt)
  }, [events, blocked])

  const sentinelRef = useInfiniteScroll(reachedEnd, loadMore, blogs.length)

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg bg-[#212121]" />)}
      </div>
    )
  }
  if (blogs.length === 0) return <p className="text-neutral-500 text-sm text-center py-12">No blog posts from people you follow.</p>

  return (
    <>
      <div className="grid grid-cols-1 gap-4">
        {blogs.map((blog) => <BlogPostCard key={blog.id} blog={blog} />)}
      </div>
      {!reachedEnd && <div ref={sentinelRef} className="h-1" />}
      {loadingMore && <LoadingMore />}
    </>
  )
}

// ─── Social feed (compose + toggles + posts) ────────────────────────────

function RepostHeader({ pubkey }: { pubkey: string }) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(pubkey, relays).then((p) => { if (!cancelled) setProfile(p) })
    return () => { cancelled = true }
  }, [pubkey])
  const npub = nip19.npubEncode(pubkey)
  const name = profile?.display_name || `${npub.slice(0, 10)}…`
  return (
    <div className="flex items-center gap-1.5 px-1 pb-1 text-xs text-neutral-500">
      <Repeat2 className="h-3.5 w-3.5" />
      Reposted by{' '}
      <Link to={`/profile/${npub}`} className="inline-flex items-center gap-1 hover:text-purple-400">
        <Avatar className="h-4 w-4">
          {profile?.picture ? <AvatarImage src={profile.picture as string} alt={name} /> : null}
          <AvatarFallback className="bg-[#212121] text-neutral-400"><User className="h-2.5 w-2.5" /></AvatarFallback>
        </Avatar>
        {name}
      </Link>
    </div>
  )
}

function FeedItem({ event }: { event: NostrEvent }) {
  if (event.kind === 6) {
    const inner = parseRepostInner(event)
    const eId = event.tags.find((t) => t[0] === 'e')?.[1]
    return (
      <div>
        <RepostHeader pubkey={event.pubkey} />
        {inner ? <SocialPost note={inner} /> : eId ? <EmbeddedNote embed={{ id: eId }} /> : null}
      </div>
    )
  }
  return <SocialPost note={event} />
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active ? 'border-purple-500/50 bg-purple-500/15 text-purple-300' : 'border-[#262626] text-neutral-400 hover:border-[#404040]',
      )}
    >
      {label}
    </button>
  )
}

function SocialFeed({ authors }: { authors: string[] }) {
  const filter = useMemo<Filter>(() => ({ kinds: [1, 6], authors }), [authors.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const { events, loading, loadingMore, reachedEnd, loadMore } = useProgressiveEvents(filter, 40)
  const blocked = useBlockStore((s) => s.blockedPubkeys)

  const [showReposts, setShowReposts] = useState(true)
  const [showQuotes, setShowQuotes] = useState(true)
  const [showReplies, setShowReplies] = useState(false)
  const [extra, setExtra] = useState<NostrEvent[]>([])
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || reachedEnd) return
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore() },
      { rootMargin: '500px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [reachedEnd, loadMore, events.length])

  const items = useMemo(() => {
    const seen = new Set<string>()
    const merged = [...extra, ...events]
      .filter((e) => { if (seen.has(e.id) || blocked.has(e.pubkey)) return false; seen.add(e.id); return true })
      .sort((a, b) => b.created_at - a.created_at)
    return merged.filter((e) => {
      const type = classifyPost(e)
      if (type === 'repost') return showReposts
      if (type === 'quote-repost') return showQuotes
      if (type === 'reply') return showReplies
      return true
    })
  }, [extra, events, blocked, showReposts, showQuotes, showReplies])

  return (
    <div className="space-y-4">
      <ComposePost onPosted={(event) => setExtra((prev) => [event, ...prev])} />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#262626] bg-[#1c1c1c] p-3">
        <span className="mr-1 text-xs text-neutral-500">Show:</span>
        <ToggleChip label="Reposts" active={showReposts} onClick={() => setShowReposts((v) => !v)} />
        <ToggleChip label="Quote reposts" active={showQuotes} onClick={() => setShowQuotes((v) => !v)} />
        <ToggleChip label="Replies" active={showReplies} onClick={() => setShowReplies((v) => !v)} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading feed…
        </div>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">
          No posts yet. Follow people and their posts will appear here.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((e) => <FeedItem key={e.kind === 6 ? `r-${e.id}` : e.id} event={e} />)}
          {!reachedEnd && <div ref={sentinelRef} className="h-1" />}
          {loadingMore && (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading more…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Tabbed feed home ───────────────────────────────────────────────────

/**
 * The mods/blog counterpart to the social tab's composer.
 *
 * Those flows are whole pages rather than an inline box, but the prompt belongs
 * in the same place — otherwise the social tab is the only one that suggests you
 * can publish anything at all.
 */
function CreatePrompt({ to, icon: Icon, label }: { to: string; icon: typeof Package; label: string }) {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return (
    <button
      type="button"
      onClick={() => { if (!isAuthenticated) { useLoginModalStore.getState().open(); return } navigate(to) }}
      className="group flex w-full items-center gap-3 rounded-lg border border-[#262626] bg-[#1c1c1c] px-4 py-3 text-left transition-colors hover:border-purple-500/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-500/10 text-purple-400">
        <Icon size={16} />
      </span>
      <span className="flex-1 text-sm text-neutral-400 transition-colors group-hover:text-neutral-200">{label}</span>
      <Plus size={16} className="shrink-0 text-neutral-600 transition-colors group-hover:text-purple-400" />
    </button>
  )
}

export function FeedView({ authors, initialTab = 'mods' }: { authors: string[]; initialTab?: 'mods' | 'blogs' | 'social' }) {
  return (
    <Tabs defaultValue={initialTab} className="w-full">
      <TabsList className="grid h-auto w-full grid-cols-3 items-stretch bg-[#1c1c1c] border border-[#262626]">
        <TabsTrigger value="mods" className={tabTrigger}>Mods</TabsTrigger>
        <TabsTrigger value="blogs" className={tabTrigger}>Blog</TabsTrigger>
        <TabsTrigger value="social" className={tabTrigger}>Social</TabsTrigger>
      </TabsList>

      <TabsContent value="mods" className="mt-4 space-y-4">
        <CreatePrompt to="/submit-mod" icon={Package} label="Publish a mod…" />
        <FeedModsTab authors={authors} />
      </TabsContent>
      <TabsContent value="blogs" className="mt-4 space-y-4">
        <CreatePrompt to="/submit-blog" icon={BookOpen} label="Write a blog post…" />
        <FeedBlogsTab authors={authors} />
      </TabsContent>
      <TabsContent value="social" className="mt-4"><SocialFeed authors={authors} /></TabsContent>
    </Tabs>
  )
}
