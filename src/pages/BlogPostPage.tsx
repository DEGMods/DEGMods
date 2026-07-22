import { DeletedPostScreen } from '@/components/shared/DeletedPostScreen'
import { useState, useEffect, useCallback } from 'react'
import type { Event as NostrEvent } from 'nostr-tools'
import { useShortUrl } from '@/hooks/useShortUrl'
import { decodePostParam, selectorFor } from '@/lib/nostr/nipShort'
import { ShortAddressChooser, postPreview } from '@/components/social/ShortAddressChooser'
import { CopyShortLinkItem } from '@/components/shared/CopyShortLinkItem'
import { getCachedEvent, whenEventCacheReady } from '@/lib/nostr/eventCache'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { streamLatestEvent } from '@/lib/nostr/streamLatest'
import { beginRefresh, endRefresh } from '@/lib/ui/refreshToast'
import { extractBlogData } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAuthStore } from '@/stores/authStore'
import { useUserStore } from '@/stores/userStore'
import type { UserProfile } from '@/stores/userStore'
import { RequestDeleteDialog } from '@/components/shared/RequestDeleteDialog'
import { ReportDialog } from '@/components/shared/ReportDialog'
import { useSeoMeta } from '@/hooks/useSeoMeta'
import { KINDS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useNsfwReveal } from '@/hooks/useNsfwReveal'
import { useModerationOverlay } from '@/hooks/useModerationTags'
import { toast } from 'sonner'
import type { BlogDetails } from '@/types/blog'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { BlossomImage } from '@/components/shared/BlossomImage'
import { Markdown } from '@/components/shared/Markdown'
import { ReactionButton } from '@/components/social/ReactionButton'
import { ZapButton } from '@/components/social/ZapButton'
import { CommentSection } from '@/components/social/CommentSection'
import { PoopIcon } from '@/components/icons/PoopIcon'
import { PublisherCard } from '@/components/mod/PublisherCard'
import { SidebarAd } from '@/components/mod/SidebarAd'
import { AuthorSocialPosts } from '@/components/social/AuthorSocialPosts'
import { AuthorBlogPosts } from '@/components/blog/AuthorBlogPosts'
import type { NostrTarget } from '@/lib/nostr/social'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

import {
  Loader2, MoreHorizontal, Copy, ExternalLink, FileJson, Edit, Trash2,
  Flag, AlertTriangle, ChevronLeft, Tag, RefreshCw, Eye
} from 'lucide-react'

export default function BlogPostPage() {
  const { naddr } = useParams<{ naddr: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const focusCommentId = searchParams.get('c')
  const { pubkey } = useAuthStore()

  const [blog, setBlog] = useState<BlogDetails | null>(null)
  const [rawEvent, setRawEvent] = useState<Record<string, unknown> | null>(null)
  const [author, setAuthor] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [choices, setChoices] = useState<NostrEvent[]>([])
  const [showReportDialog, setShowReportDialog] = useState(false)
  const [newerEvent, setNewerEvent] = useState<NostrEvent | null>(null)
  const [deleted, setDeleted] = useState(false)
  const [featuredLoaded, setFeaturedLoaded] = useState(false)

  const [showRawDialog, setShowRawDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const isOwner = rawEvent && pubkey ? (rawEvent as { pubkey?: string }).pubkey === pubkey : false

  const { revealed: cwRevealed, reveal: revealCw } = useNsfwReveal()
  // Tags the admin applied on top of this post's own (kind 30985 overlay).
  const { overlay: tagOverlay, checked: tagsChecked } = useModerationOverlay(blog?.aTag)
  const contentWarning = blog?.contentWarning || tagOverlay?.contentWarning
  const hasCW = !!contentWarning
  // Blur until the overlay has settled too, so a post the admin marked NSFW
  // can't flash before the check lands.
  const heroBlurred = (hasCW && !cwRevealed) || (!tagsChecked && !blog?.contentWarning)

  // Show the short address in the URL bar once this post has one.
  useShortUrl(rawEvent as unknown as NostrEvent | null, '/blog')

  // Render a fetched event into page state (initial + refresh), incl. author.
  const applyEvent = useCallback((event: NostrEvent) => {
    setRawEvent(event as unknown as Record<string, unknown>)
    const blogData = extractBlogData(event)
    if (blogData.isDeleted) { setDeleted(true); setLoading(false); return }
    setBlog(blogData)
    setLoading(false)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(event.pubkey, relays).then(setAuthor).catch(() => {})
  }, [])

  // Fetch blog event (cache-first, background staleness check)
  useEffect(() => {
    if (!naddr) return
    let cancelled = false
    /** Tears down the cold-view watch early (set once it starts). */
    let stopWatch: (() => void) | null = null

    async function load() {
      setNotFound(false)
      setDeleted(false)
      setNewerEvent(null)

      // The param is an naddr, or a NIP-SHORT address once the URL has been
      // rewritten — a reload lands here with the short form.
      const relaysForDecode = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const decoded = await decodePostParam(naddr!, relaysForDecode)
      if (cancelled) return
      if (!decoded) { setNotFound(true); setLoading(false); return }
      // Ambiguous short address — the reader picks, then load resumes below.
      if ('candidates' in decoded) { setChoices(decoded.candidates); setLoading(false); return }
      const { pubkey: authorPk, identifier, kind, event: resolved } = decoded
      const coord = `${kind}:${authorPk}:${identifier}`
      if (resolved) applyEvent(resolved)

      // Await hydration so a cold reload doesn't miss the persisted cache.
      await whenEventCacheReady
      if (cancelled) return
      const cached = getCachedEvent(coord)
      if (cached) applyEvent(cached)
      else setLoading(true)

      try {
        const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const filter = { kinds: [kind], authors: [authorPk], '#d': [identifier] }

        // With a cached copy on screen, latency is hidden — use the
        // high-assurance multi-pass fetch so a newer revision on a slow relay is
        // reliably caught.
        if (cached) {
          const event = await fetchLatestEvent(relayUrls, filter)
          if (cancelled || !event) return
          if (event.created_at > cached.created_at) setNewerEvent(event) // prompt, don't force
          return
        }

        // Cold view: render whichever relay answers first, then keep listening.
        const w = streamLatestEvent(relayUrls, filter, {
          have: resolved ?? null,
          onApply: (ev) => { if (!cancelled) applyEvent(ev) },
          onNewer: (ev) => { if (!cancelled) setNewerEvent(ev) },
          onEmpty: () => { if (!cancelled) { setNotFound(true); setLoading(false) } },
          onWatching: (on) => (on ? beginRefresh() : endRefresh()),
        })
        stopWatch = w.stop
        await w.done
      } catch {
        if (!cancelled && !cached) { setNotFound(true); setLoading(false) }
      }
    }

    load()
    // Navigating away mid-watch has to close the subscription and release the
    // indicator, or the pill would stay up for the rest of the session.
    return () => { cancelled = true; stopWatch?.() }
  }, [naddr, applyEvent])

  // Cooperative rebroadcast: after the post's been on screen a few seconds, help
  // keep it replicated across relays. Cancels on navigation so a drive-by view
  // doesn't trigger it; deduped per session inside the module.
  useEffect(() => {
    if (!rawEvent) return
    const ev = rawEvent as unknown as NostrEvent
    const t = setTimeout(() => {
      import('@/lib/nostr/eventRedundancy').then(({ ensureEventPresent }) => ensureEventPresent(ev))
    }, 8000)
    return () => clearTimeout(t)
  }, [rawEvent])

  const handleCopyNaddr = () => {
    if (!naddr) return
    navigator.clipboard.writeText(naddr)
    toast.success('Note ID copied to clipboard')
  }

  const handleCopyNpub = () => {
    const eventPubkey = (rawEvent as { pubkey?: string })?.pubkey
    if (!eventPubkey) return
    const npub = nip19.npubEncode(eventPubkey)
    navigator.clipboard.writeText(npub)
    toast.success('Author npub copied to clipboard')
  }

  const handleCopyRawJson = () => {
    if (!rawEvent) return
    navigator.clipboard.writeText(JSON.stringify(rawEvent, null, 2))
    toast.success('Raw JSON copied to clipboard')
  }

  const publishedDate = blog?.publishedAt
    ? new Date(blog.publishedAt * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  useSeoMeta(blog ? {
    title: blog.title,
    description: blog.summary || blog.content,
    type: 'article',
  } : null)

  // An ambiguous short address: nothing to show until the reader picks.
  if (choices.length > 0) {
    return (
      <ShortAddressChooser
        open
        onOpenChange={(o) => { if (!o) { setChoices([]); setNotFound(true) } }}
        candidates={choices}
        renderPreview={postPreview}
        onChoose={(ev) => {
          const suffix = selectorFor(ev, choices)
          if (suffix && naddr) window.history.replaceState(null, '', `/blog/${naddr}-${suffix}`)
          setChoices([])
          applyEvent(ev)
        }}
      />
    )
  }

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    )
  }

  // --- Not found state ---
  if (notFound || !blog) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertTriangle className="h-12 w-12 text-neutral-500" />
        <h2 className="text-xl font-semibold text-neutral-200">Blog post not found</h2>
        <p className="text-neutral-400 text-sm">
          The blog post you're looking for doesn't exist or has been removed.
        </p>
        <Button variant="outline" onClick={() => navigate('/blog')}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Blog
        </Button>
      </div>
    )
  }

  // --- Deleted state ---
  if (deleted) {
    return (
      <DeletedPostScreen
        noun="blog post"
        heading="Blog post"
        event={rawEvent as unknown as NostrEvent | null}
        title={blog?.title}
        backTo="/blog"
        backLabel="Back to Blog"
      />
    )
  }

  const blogTarget: NostrTarget = {
    id: blog.id,
    pubkey: blog.pubkey,
    kind: KINDS.BLOG,
    aTag: blog.aTag,
  }

  return (
    <div className="w-full py-6 space-y-6">
      {/* Two-column layout: content left, author + reactions right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column: content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Featured image */}
          {blog.featuredImageUrl && (
            <div className="relative w-full aspect-video overflow-hidden rounded-xl">
              {!featuredLoaded && (
                <div className="absolute inset-0 bg-[#262626] animate-pulse z-[1]" />
              )}
              <BlossomImage
                src={blog.featuredImageUrl}
                alt={blog.title}
                className={cn(
                  'absolute inset-0 z-[2] h-full w-full object-cover',
                  heroBlurred && 'blur-xl',
                )}
                onLoad={() => setFeaturedLoaded(true)}
                onError={() => setFeaturedLoaded(true)}
              />
              {hasCW && !cwRevealed && (
                <div
                  className="absolute inset-0 z-[3] flex cursor-pointer flex-col items-center justify-center bg-black/40"
                  onClick={() => revealCw()}
                >
                  <Eye className="mb-2 h-8 w-8 text-neutral-300" />
                  <span className="text-sm font-medium text-neutral-300">
                    Content Warning: {contentWarning}
                  </span>
                  <span className="mt-1 text-xs text-neutral-500">Click to reveal</span>
                </div>
              )}
            </div>
          )}

          {/* Title + actions */}
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-3xl font-bold text-neutral-100 tracking-tight leading-tight">
              {blog.title}
            </h1>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0 text-neutral-400 hover:bg-[#262626] hover:text-white">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-[#1c1c1c] border-[#262626]">
                <DropdownMenuItem onClick={handleCopyNaddr} className="cursor-pointer">
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Note ID
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyNpub} className="cursor-pointer">
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Author npub
                </DropdownMenuItem>
                {rawEvent && <CopyShortLinkItem event={rawEvent as unknown as NostrEvent} basePath="/blog" />}
                <DropdownMenuItem onClick={() => setShowRawDialog(true)} className="cursor-pointer">
                  <FileJson className="h-4 w-4 mr-2" />
                  View Raw Event
                </DropdownMenuItem>

                <DropdownMenuSeparator className="bg-[#262626]" />

                {isOwner ? (
                  <>
                    <DropdownMenuItem
                      // Rebuilt from the post, not the URL param — by now the bar
                      // holds a short address, which the editor can't decode.
                      onClick={() => navigate(`/submit-blog?edit=${nip19.naddrEncode({
                        kind: KINDS.BLOG,
                        pubkey: blog.pubkey,
                        identifier: blog.dTag,
                      })}`)}
                      className="cursor-pointer"
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setShowDeleteDialog(true)}
                      className="cursor-pointer text-red-400 focus:text-red-400"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Request Delete
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem
                    onClick={() => setShowReportDialog(true)}
                    className="cursor-pointer"
                  >
                    <Flag className="h-4 w-4 mr-2" />
                    Report
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Body */}
          <div className="bg-[#1c1c1c] rounded-lg p-6 shadow-md shadow-black/20">
            <Markdown content={blog.content} />
          </div>

          {/* Tags */}
          {blog.tags && blog.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {blog.tags.map(tag => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 transition-colors"
                >
                  <Tag className="h-3 w-3 mr-1" />
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Right column: author + reactions */}
        <div className="space-y-6">
          <PublisherCard pubkey={blog.pubkey} />

          <div className="flex items-center gap-2 flex-wrap">
            <ReactionButton target={blogTarget} bucket="positive" />
            <ReactionButton target={blogTarget} content="💩" bucket="negative" icon={PoopIcon} />
            <ZapButton target={blogTarget} recipientLud16={author?.lud16 as string | undefined} />
          </div>

          {publishedDate && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-neutral-200">Published</h2>
              <p className="text-sm text-neutral-400">{publishedDate}</p>
              {blog.client && <p className="text-xs text-neutral-500">from {blog.client}</p>}
            </section>
          )}

          {/* Author's latest social posts */}
          <AuthorSocialPosts pubkey={blog.pubkey} />

          {/* Rotating sponsored ad */}
          <SidebarAd />
        </div>
      </div>

      <Separator className="bg-[#262626]" />

      {/* Author's other blog posts */}
      <AuthorBlogPosts pubkey={blog.pubkey} excludeATag={blog.aTag} />

      <Separator className="bg-[#262626]" />

      {/* Comments */}
      <CommentSection root={blogTarget} focusCommentId={focusCommentId} />

      {/* Request-delete dialog (confirm + progress) */}
      <RequestDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        event={rawEvent as unknown as Parameters<typeof RequestDeleteDialog>[0]['event']}
        title={blog.title}
        noun="blog post"
        onDeleted={() => { setDeleted(true); setShowDeleteDialog(false) }}
      />

      <ReportDialog
        open={showReportDialog}
        onOpenChange={setShowReportDialog}
        target={{ eventId: blog.id, coord: blog.aTag, kind: KINDS.BLOG, authorPubkey: blog.pubkey, title: blog.title }}
      />

      {/* Raw Event dialog */}
      <Dialog open={showRawDialog} onOpenChange={setShowRawDialog}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626] max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-neutral-100">
              <FileJson className="h-5 w-5 text-purple-400" />
              Raw Event
            </DialogTitle>
            <DialogDescription className="text-neutral-400">
              The raw Nostr event data for this blog post.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded-lg bg-[#171717] border border-[#262626] p-4">
            <pre className="text-xs text-neutral-300 font-mono whitespace-pre-wrap break-all">
              <code>{rawEvent ? JSON.stringify(rawEvent, null, 2) : ''}</code>
            </pre>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCopyRawJson}
              className="border-[#262626]"
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy JSON
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Newer version available — prompt instead of force-refreshing */}
      <Dialog open={!!newerEvent} onOpenChange={(o) => { if (!o) setNewerEvent(null) }}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Newer version available</DialogTitle>
            <DialogDescription className="text-neutral-400">
              This post was updated since you opened it. Refresh to load the latest version.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewerEvent(null)} className="border-[#262626]">Dismiss</Button>
            <Button
              onClick={() => { if (newerEvent) applyEvent(newerEvent); setNewerEvent(null) }}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
