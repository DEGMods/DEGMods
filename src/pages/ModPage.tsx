import { useState, useEffect, useMemo, useCallback } from 'react'
import type { Event as NostrEvent } from 'nostr-tools'
import { useShortUrl } from '@/hooks/useShortUrl'
import { decodePostParam } from '@/lib/nostr/nipShort'
import { CopyShortLinkItem } from '@/components/shared/CopyShortLinkItem'
import { getCachedEvent, whenEventCacheReady } from '@/lib/nostr/eventCache'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { fetchEvent, fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { extractModData } from '@/lib/nostr/events'
import { LEGACY_MOD_KIND, extractLegacyModData } from '@/lib/mods/legacy' // LEGACY
import { LegacyMigrateBanner, LegacyMigratedNotice } from '@/components/mod/LegacyMigrate' // LEGACY
import { useSettingsStore } from '@/stores/settingsStore'
import { useAuthStore } from '@/stores/authStore'
import { KINDS } from '@/lib/constants'
import { cn, isHttpUrl } from '@/lib/utils'
import { toast } from 'sonner'
import type { ModDetails } from '@/types/mod'

import { CollapsibleMarkdown } from '@/components/mod/CollapsibleMarkdown'
import { ModJamBanner } from '@/components/jam/ModJamBanner'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { ModScreenshots } from '@/components/mod/ModScreenshots'
import { ModDownloads } from '@/components/mod/ModDownloads'
import { ShareBox } from '@/components/mod/ShareBox'
import { ReportDialog } from '@/components/shared/ReportDialog'
import { ModRefValue, classifyRef } from '@/components/mod/ModRefValue'
import { useSeoMeta } from '@/hooks/useSeoMeta'
import { ModPermissions } from '@/components/mod/ModPermissions'
import { PublisherCard } from '@/components/mod/PublisherCard'
import { SidebarAd } from '@/components/mod/SidebarAd'
import { AuthorSocialPosts } from '@/components/social/AuthorSocialPosts'
import { ReactionButton } from '@/components/social/ReactionButton'
import { ZapButton } from '@/components/social/ZapButton'
import { CommentSection } from '@/components/social/CommentSection'
import { AuthorBlogPosts } from '@/components/blog/AuthorBlogPosts'
import { AuthorMods } from '@/components/mod/AuthorMods'
import { RequestDeleteDialog } from '@/components/shared/RequestDeleteDialog'
import { ModerationHiddenWarning, ModerationBlockedScreen } from '@/components/mod/ModerationNotice'
import { useModStatus } from '@/hooks/useModeration'
import type { NostrTarget } from '@/lib/nostr/social'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

import {
  Loader2, MoreHorizontal, Copy, ExternalLink, FileJson, Edit, Trash2,
  Flag, Eye, AlertTriangle, ChevronLeft, ChevronDown, ChevronRight, Gamepad2, Tag,
  User, Repeat2, Joystick, Layers, Boxes, RefreshCw, History, Image as ImageIcon, Film
} from 'lucide-react'
import { PoopIcon } from '@/components/icons/PoopIcon'

/**
 * Pretty-print an event, expanding any JSON-encoded tag values (e.g. the
 * `download` objects) into real nested objects — so they read cleanly instead
 * of as one escaped, backslash-laden string.
 */
function readableEventJson(ev: Record<string, unknown>): string {
  const out = { ...ev }
  if (Array.isArray(out.tags)) {
    out.tags = (out.tags as unknown[]).map((tag) =>
      Array.isArray(tag)
        ? tag.map((el) => {
            if (typeof el === 'string') {
              const t = el.trim()
              if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
                try { return JSON.parse(t) } catch { /* leave as string */ }
              }
            }
            return el
          })
        : tag,
    )
  }
  return JSON.stringify(out, null, 2)
}

/**
 * Resolve a featured-video URL into how it should be shown: a direct file, or a
 * YouTube/Vimeo iframe embed (those don't play in a <video> tag).
 */
function parseVideoEmbed(url: string): { type: 'file' | 'youtube' | 'vimeo'; src: string } {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i)
  if (yt) return { type: 'youtube', src: `https://www.youtube.com/embed/${yt[1]}` }
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i)
  if (vm) return { type: 'vimeo', src: `https://player.vimeo.com/video/${vm[1]}` }
  return { type: 'file', src: url }
}

export default function ModPage() {
  const { naddr } = useParams<{ naddr: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const focusCommentId = searchParams.get('c')
  const { pubkey } = useAuthStore()

  const [mod, setMod] = useState<ModDetails | null>(null)
  const [rawEvent, setRawEvent] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [cwRevealed, setCwRevealed] = useState(false)
  const [heroLoaded, setHeroLoaded] = useState(false)
  const [heroShowImage, setHeroShowImage] = useState(false) // toggle featured video ⇄ image
  const [permsOpen, setPermsOpen] = useState(false)
  const [depsOpen, setDepsOpen] = useState(true)

  const [showRawDialog, setShowRawDialog] = useState(false)
  const [showElsewhereDialog, setShowElsewhereDialog] = useState(false)
  const [showReportDialog, setShowReportDialog] = useState(false)
  const [readableRaw, setReadableRaw] = useState(false)
  const rawJson = useMemo(
    () => (rawEvent ? (readableRaw ? readableEventJson(rawEvent) : JSON.stringify(rawEvent, null, 2)) : ''),
    [rawEvent, readableRaw],
  )
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [newerEvent, setNewerEvent] = useState<NostrEvent | null>(null)

  const modStatus = useModStatus(mod?.aTag, mod?.pubkey)

  // Show the short address in the URL bar once this post has one.
  useShortUrl(rawEvent as unknown as NostrEvent | null, '/mod')

  const isOwner = rawEvent && pubkey ? (rawEvent as { pubkey?: string }).pubkey === pubkey : false

  // Render a fetched event into page state (used for both initial and refresh).
  const applyEvent = useCallback((event: NostrEvent) => {
    setRawEvent(event as unknown as Record<string, unknown>)
    // LEGACY: old mods are a different kind (30402) with a different tag schema.
    const modData = event.kind === LEGACY_MOD_KIND ? extractLegacyModData(event) : extractModData(event)
    if (modData.isDeleted) { setDeleted(true); setLoading(false); return }
    setMod(modData)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!naddr) return
    let cancelled = false

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
      const { pubkey: author, identifier, kind, event: resolved } = decoded
      const coord = `${kind}:${author}:${identifier}`
      // A short address already fetched the event; show it rather than waiting
      // on the cache lookup and refetch below.
      if (resolved) applyEvent(resolved)

      // 1. Instant render from what a list already fetched (or a prior session,
      // via the persisted cache), if available. Await hydration so a cold reload
      // doesn't miss the IndexedDB copy.
      await whenEventCacheReady
      if (cancelled) return
      const cached = getCachedEvent(coord)
      if (cached) applyEvent(cached)
      else setLoading(true)

      // 2. Background re-fetch to check for a newer version. With a cached copy
      // to show, latency is hidden — use the high-assurance multi-pass fetch so
      // a newer revision on a slow/cold relay is reliably caught. On a cold first
      // view (no cache) keep the fast single-pass fetch so the page renders quickly.
      try {
        const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const filter = { kinds: [kind], authors: [author], '#d': [identifier] }
        const event = cached
          ? await fetchLatestEvent(relayUrls, filter)
          : await fetchEvent(relayUrls, filter)
        if (cancelled) return
        if (!event) {
          if (!cached) { setNotFound(true); setLoading(false) }
          return
        }
        if (!cached) applyEvent(event)
        else if (event.created_at > cached.created_at) setNewerEvent(event) // prompt, don't force
      } catch {
        if (!cancelled && !cached) { setNotFound(true); setLoading(false) }
      }
    }

    load()
    return () => { cancelled = true }
  }, [naddr, applyEvent])

  // Cooperative rebroadcast: after the mod's been on screen a few seconds, help
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
    if (!rawJson) return
    navigator.clipboard.writeText(rawJson)
    toast.success(readableRaw ? 'Readable JSON copied to clipboard' : 'Raw JSON copied to clipboard')
  }


  const publishedDate = mod?.publishedAt
    ? new Date(mod.publishedAt * 1000).toLocaleString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  // LEGACY: don't emit SEO meta for legacy (kind-30402) posts — migrated or not.
  // The migrated post is a normal kind-31142 mod and gets meta as usual.
  useSeoMeta(mod && !mod.legacy ? {
    title: mod.title,
    description: mod.summary || mod.content,
    image: mod.featuredImageUrl,
    type: 'article',
  } : null)

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    )
  }

  // --- Hard moderation: render-blocked by the admins ---
  if (modStatus.blockRender) {
    return <ModerationBlockedScreen />
  }

  // --- Not found state ---
  if (notFound || !mod) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertTriangle className="h-12 w-12 text-neutral-500" />
        <h2 className="text-xl font-semibold text-neutral-200">Mod not found</h2>
        <p className="text-neutral-400 text-sm">
          The mod you're looking for doesn't exist or has been removed.
        </p>
        <Button variant="outline" onClick={() => navigate('/mods')}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Mods
        </Button>
      </div>
    )
  }

  // --- Deleted state ---
  if (deleted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Trash2 className="h-12 w-12 text-red-400" />
        <h2 className="text-xl font-semibold text-neutral-200">Mod deleted</h2>
        <p className="text-neutral-400 text-sm">
          This mod has been permanently deleted.
        </p>
        <Button variant="outline" onClick={() => navigate('/mods')}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Mods
        </Button>
      </div>
    )
  }

  const hasCW = !!mod.contentWarning
  const heroBlurred = hasCW && !cwRevealed

  const modTarget: NostrTarget = {
    id: mod.id,
    pubkey: mod.pubkey,
    kind: mod.legacy ? LEGACY_MOD_KIND : KINDS.MOD, // LEGACY: keep k tags correct
    aTag: mod.aTag,
  }

  // A dedicated Featured Video is the hero (image is its poster / toggle target).
  // The image field may itself be a video file (legacy) — kept as a decorative loop.
  const videoUrl = mod.featuredVideoUrl?.trim() || undefined
  const imageUrl = mod.featuredImageUrl?.trim() || undefined
  const imageIsVideoFile = !!imageUrl && (imageUrl.endsWith('.mp4') || imageUrl.endsWith('.webm'))
  const embed = videoUrl ? parseVideoEmbed(videoUrl) : null
  // Offer a video⇄image toggle only when there's a real image to switch to.
  const canToggleHero = !!videoUrl && !!imageUrl && !imageIsVideoFile
  const showVideo = !!videoUrl && !heroShowImage

  const heroMedia = (imageUrl || videoUrl) && (
    <div className="group relative w-full aspect-video overflow-hidden rounded-xl">
      {/* Hover toggle: switch between the featured video and the featured image */}
      {canToggleHero && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setHeroShowImage((v) => !v) }}
          className="absolute right-2 top-2 z-[4] inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 group-hover:opacity-100"
        >
          {heroShowImage ? <><Film className="h-3.5 w-3.5" /> Video</> : <><ImageIcon className="h-3.5 w-3.5" /> Image</>}
        </button>
      )}

      {showVideo && embed?.type === 'file' ? (
        <>
          {!heroLoaded && <div className="absolute inset-0 bg-[#262626] animate-pulse z-[1]" />}
          <video
            src={embed.src}
            poster={imageUrl}
            className={cn('absolute inset-0 z-[2] w-full h-full object-cover', heroBlurred && 'blur-xl')}
            controls
            playsInline
            onLoadedData={() => setHeroLoaded(true)}
          />
        </>
      ) : showVideo && embed ? (
        // YouTube / Vimeo embed (no autoplay — shows the platform's play button)
        <iframe
          src={embed.src}
          title={mod.title}
          className={cn('absolute inset-0 z-[2] w-full h-full', heroBlurred && 'blur-xl')}
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : imageIsVideoFile ? (
        <>
          {!heroLoaded && <div className="absolute inset-0 bg-[#262626] animate-pulse z-[1]" />}
          <video
            src={imageUrl}
            className={cn('absolute inset-0 z-[2] w-full h-full object-cover', heroBlurred && 'blur-xl cursor-pointer')}
            autoPlay
            loop
            muted
            playsInline
            onLoadedData={() => setHeroLoaded(true)}
            onClick={() => hasCW && setCwRevealed(true)}
          />
        </>
      ) : (
        // Hash-verified featured image (skeleton + Blossom failover handled inside)
        <SkeletonImage
          src={imageUrl}
          alt={mod.title}
          loading="eager"
          className={cn(
            'absolute inset-0 z-[2] w-full h-full object-cover',
            heroBlurred && 'blur-xl cursor-pointer'
          )}
        />
      )}
      {heroBlurred && (
        <div
          className="absolute inset-0 z-[3] flex flex-col items-center justify-center bg-black/40 cursor-pointer"
          onClick={() => setCwRevealed(true)}
        >
          <Eye className="h-8 w-8 text-neutral-300 mb-2" />
          <span className="text-sm text-neutral-300 font-medium">
            Content Warning: {mod.contentWarning}
          </span>
          <span className="text-xs text-neutral-500 mt-1">Click to reveal</span>
        </div>
      )}
    </div>
  )

  return (
    <div className="w-full py-6 space-y-6">
      {modStatus.moderated && <ModerationHiddenWarning />}

      {/* LEGACY: old kind-30402 mod notice */}
      {mod.legacy && (
        <div className="flex items-start gap-3 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
          <History className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-orange-300">Legacy mod</p>
            <p className="text-sm text-neutral-300">
              DEG Mods migrated to a new dedicated post structure for mods. You&apos;re viewing an old mod post from the legacy system.
            </p>
          </div>
        </div>
      )}

      {/* LEGACY: author-only migrate banner + steps */}
      {mod.legacy && isOwner && !mod.legacyMigrated && rawEvent && (
        <LegacyMigrateBanner rawEvent={rawEvent as unknown as NostrEvent} mod={mod} />
      )}

      {/* LEGACY: this legacy post has been migrated — send visitors to the new one */}
      {mod.legacy && mod.legacyMigrated && <LegacyMigratedNotice mod={mod} />}

      {/* Title area */}
      <div className="flex items-start justify-between gap-3">
          <h1 className="text-3xl font-bold text-neutral-100 tracking-tight">
            {mod.title}
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
            {rawEvent && <CopyShortLinkItem event={rawEvent as unknown as NostrEvent} basePath="/mod" />}
            <DropdownMenuItem onClick={() => setShowRawDialog(true)} className="cursor-pointer">
              <FileJson className="h-4 w-4 mr-2" />
              View Raw Event
            </DropdownMenuItem>
            {mod.elsewhere.length > 0 && (
              <DropdownMenuItem onClick={() => setShowElsewhereDialog(true)} className="cursor-pointer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Available elsewhere
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator className="bg-[#262626]" />

            {isOwner ? (
              <>
                {/* LEGACY: legacy mods can't be edited — migrate first. */}
                {!mod.legacy && (
                  <DropdownMenuItem
                    onClick={() => navigate(`/mod/${naddr}/edit`)}
                    className="cursor-pointer"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                )}
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

      <Separator className="bg-[#262626]" />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column: main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Featured image/video */}
          {heroMedia}

          {/* Body */}
          {mod.content && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-neutral-200">About</h2>
                {mod.game && (
                  <Link to={`/game/${mod.game}`} className="w-fit">
                    <Badge
                      variant="outline"
                      className="border-purple-500/40 text-purple-400 hover:bg-purple-500/10 transition-colors cursor-pointer"
                    >
                      <Gamepad2 className="h-3 w-3 mr-1" />
                      {mod.game}
                    </Badge>
                  </Link>
                )}
              </div>
              <CollapsibleMarkdown content={mod.content} />
            </section>
          )}

          {/* Screenshots */}
          {mod.screenshots && mod.screenshots.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-neutral-200">Screenshots</h2>
              <ModScreenshots
                screenshots={mod.screenshots}
                blurred={heroBlurred}
                onReveal={() => setCwRevealed(true)}
              />
            </section>
          )}

          {/* Publisher notes */}
          {mod.notes && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-neutral-200">Publisher Notes</h2>
              <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-5 shadow-md shadow-black/20">
                <p className="text-neutral-300 text-sm leading-relaxed whitespace-pre-wrap">
                  {mod.notes}
                </p>
              </div>
            </section>
          )}

          {/* Credits */}
          {mod.credits && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-neutral-200">Credits</h2>
              <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-5 shadow-md shadow-black/20">
                <p className="text-neutral-300 text-sm leading-relaxed whitespace-pre-wrap">
                  {mod.credits}
                </p>
              </div>
            </section>
          )}
        </div>

        {/* Right column: sidebar */}
        <div className="space-y-6">
          {/* Publisher */}
          <PublisherCard pubkey={(rawEvent as { pubkey: string }).pubkey} />

          {/* Reactions + zaps */}
          <div className="flex items-center gap-2 flex-wrap">
            <ReactionButton target={modTarget} bucket="positive" />
            <ReactionButton target={modTarget} content="💩" bucket="negative" icon={PoopIcon} />
            <ZapButton target={modTarget} />
          </div>

          {/* Repost */}
          {mod.isRepost && (
            <section className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-lg font-semibold text-neutral-200">
                <Repeat2 className="h-4 w-4 text-purple-400" />
                Repost
              </h2>
              <div className="space-y-2 rounded-lg bg-[#1c1c1c] p-3 shadow-md shadow-black/20">
                <p className="text-sm text-neutral-400">
                  This is a repost of another creator's mod.
                </p>
                {mod.originalAuthor && (() => {
                  const v = mod.originalAuthor.trim()
                  if (/^https?:\/\//i.test(v)) {
                    return (
                      <a
                        href={v}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-[#404040] hover:bg-[#262626]"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Original source
                      </a>
                    )
                  }
                  if (/^npub1[0-9a-z]+$/i.test(v)) {
                    return (
                      <Link
                        to={`/profile/${v}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-[#404040] hover:bg-[#262626]"
                      >
                        <User className="h-3.5 w-3.5" />
                        Original author
                      </Link>
                    )
                  }
                  return <p className="text-sm text-neutral-300">Original author: {v}</p>
                })()}
              </div>
            </section>
          )}

          {/* Downloads */}
          {mod.downloads && mod.downloads.length > 0 && (
            <ModDownloads downloads={mod.downloads} root={modTarget} />
          )}

          {/* Dependencies (collapsible) */}
          {mod.dependencies && mod.dependencies.length > 0 && (
            <section className="space-y-3">
              <button
                onClick={() => setDepsOpen(o => !o)}
                className="flex w-full items-center justify-between text-lg font-semibold text-neutral-200"
                aria-expanded={depsOpen}
              >
                <span className="flex items-center gap-2"><Boxes className="h-5 w-5 text-purple-400" /> Dependencies</span>
                <ChevronDown className={cn('h-5 w-5 text-neutral-400 transition-transform', depsOpen && 'rotate-180')} />
              </button>
              {depsOpen && (
                <div className="space-y-2">
                  {mod.dependencies.map((dep, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#262626] bg-[#1c1c1c] px-3 py-2.5">
                      {dep.title
                        ? <span className="text-sm font-medium text-neutral-200">{dep.title}</span>
                        : <ModRefValue value={dep.value} />}
                      {dep.title && dep.value && <ModRefValue value={dep.value} />}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Share */}
          {naddr && <ShareBox url={`${window.location.origin}/mod/${naddr}`} title={mod.title} />}

          {/* Permissions (collapsible) */}
          {mod.permissions && (
            <section className="space-y-3">
              <button
                onClick={() => setPermsOpen(o => !o)}
                className="flex w-full items-center justify-between text-lg font-semibold text-neutral-200"
                aria-expanded={permsOpen}
              >
                Permissions
                <ChevronDown className={cn('h-5 w-5 text-neutral-400 transition-transform', permsOpen && 'rotate-180')} />
              </button>
              {permsOpen && <ModPermissions permissions={mod.permissions} />}
            </section>
          )}

          {/* Categories: each is a clickable hierarchical chain (cat1 › cat2 › cat3) */}
          {mod.categories && mod.categories.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-neutral-200">Categories</h2>
              <div className="space-y-2">
                {mod.categories.map((cat) => {
                  const parts = cat.split(':').filter(Boolean)
                  return (
                    <div key={cat} className="flex w-fit flex-wrap items-center gap-1 rounded-lg bg-[#171717] px-2 py-1.5 text-sm">
                      {parts.map((part, i) => {
                        const prefix = parts.slice(0, i + 1).join(':')
                        return (
                          <div key={i} className="flex items-center gap-1">
                            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-neutral-600" />}
                            <Link
                              to={`/mods?category=${encodeURIComponent(prefix)}`}
                              className="rounded-md bg-[#212121] px-2 py-0.5 text-neutral-300 transition-colors hover:bg-purple-500/10 hover:text-purple-300"
                            >
                              {part}
                            </Link>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* For another mod */}
          {mod.forMod && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm text-purple-200">
                <Layers className="h-4 w-4 shrink-0 text-purple-400" />
                <span>
                  This is a mod for another mod
                  {classifyRef(mod.forMod) === 'text' && <>: <span className="font-medium text-purple-100">{mod.forMod}</span></>}
                </span>
              </span>
              {classifyRef(mod.forMod) !== 'text' && <ModRefValue value={mod.forMod} tone="accent" />}
            </div>
          )}

          {/* Emulation notice */}
          {mod.emulation && (
            <div className="flex items-start gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2.5 text-sm text-purple-200">
              <Joystick className="h-4 w-4 shrink-0 mt-0.5 text-purple-400" />
              <span>
                This mod is for an <span className="font-medium">emulated</span> version of the game
                {mod.emulatedPlatform ? <> on <span className="font-medium">{mod.emulatedPlatform}</span></> : null}.
              </span>
            </div>
          )}

          {/* Tags — hidden for LEGACY mods */}
          {!mod.legacy && mod.tags && mod.tags.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-neutral-200">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {mod.tags.map((tag) => (
                  <Link key={tag} to={`/mods?tag=${encodeURIComponent(tag)}`}>
                    <Badge
                      variant="outline"
                      className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 transition-colors cursor-pointer"
                    >
                      <Tag className="h-3 w-3 mr-1" />
                      {tag}
                    </Badge>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Published date */}
          {publishedDate && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-neutral-200">Published</h2>
              <p className="text-sm text-neutral-400">{publishedDate}</p>
              {mod.client && <p className="text-xs text-neutral-500">on {mod.client}</p>}
            </section>
          )}

          {/* Mod jam entry: the jam this mod was submitted to, rank + voting */}
          {mod.jamCoordinate && (
            <ModJamBanner
              jamCoordinate={mod.jamCoordinate}
              submissionCoordinate={mod.aTag}
              submissionDTag={mod.dTag}
              submissionTitle={mod.title}
            />
          )}

          {/* Author's latest social posts */}
          <AuthorSocialPosts pubkey={mod.pubkey} />

          {/* Rotating sponsored ad */}
          <SidebarAd />
        </div>
      </div>

      <Separator className="bg-[#262626]" />

      {/* Author's latest mods */}
      <AuthorMods pubkey={mod.pubkey} excludeATag={mod.aTag} />

      {/* Author's latest blog posts */}
      <AuthorBlogPosts pubkey={mod.pubkey} />

      {/* Comments */}
      <CommentSection root={modTarget} focusCommentId={focusCommentId} modDownloads={mod.downloads} />

      {/* Request-delete dialog (confirm + progress) */}
      <RequestDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        event={rawEvent as unknown as Parameters<typeof RequestDeleteDialog>[0]['event']}
        title={mod.title}
        noun="mod"
        onDeleted={() => { setDeleted(true); setShowDeleteDialog(false) }}
      />

      {/* Available elsewhere dialog */}
      <Dialog open={showElsewhereDialog} onOpenChange={setShowElsewhereDialog}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-neutral-100">
              <ExternalLink className="h-5 w-5 text-purple-400" />
              Available elsewhere
            </DialogTitle>
            <DialogDescription className="text-neutral-400">
              Other places the publisher says this mod is available. These are external sites — DEG Mods
              doesn&apos;t vet them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {mod.elsewhere.map((entry, i) =>
              isHttpUrl(entry) ? (
                <a
                  key={i}
                  href={entry}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2.5 transition-colors hover:border-[#404040]"
                >
                  <span className="min-w-0 truncate font-mono text-xs text-neutral-300">{entry}</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-purple-400">
                    Open <ExternalLink className="h-3.5 w-3.5" />
                  </span>
                </a>
              ) : (
                // Not a link (another client may put anything here) — never make it
                // clickable; offer it as copyable text instead.
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2.5"
                >
                  <span className="min-w-0 truncate font-mono text-xs text-neutral-400">{entry}</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(entry); toast.success('Copied to clipboard') }}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200"
                  >
                    Copy <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              ),
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Raw Event dialog */}
      <Dialog open={showRawDialog} onOpenChange={setShowRawDialog}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626] max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-neutral-100">
              <FileJson className="h-5 w-5 text-purple-400" />
              Raw Event
            </DialogTitle>
            <DialogDescription className="text-neutral-400">
              The raw Nostr event data for this mod.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center justify-end gap-2 cursor-pointer">
            <span className="text-xs text-neutral-400">Readable</span>
            <Switch checked={readableRaw} onCheckedChange={setReadableRaw} />
          </label>
          <div className="flex-1 overflow-auto rounded-lg bg-[#171717] border border-[#262626] p-4">
            <pre className="text-xs text-neutral-300 font-mono whitespace-pre-wrap break-all">
              <code>{rawJson}</code>
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
              This mod was updated since you opened it. Refresh to load the latest version.
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

      {/* Report dialog */}
      {mod && (
        <ReportDialog
          open={showReportDialog}
          onOpenChange={setShowReportDialog}
          target={{
            eventId: mod.id,
            coord: mod.aTag,
            kind: mod.legacy ? LEGACY_MOD_KIND : KINDS.MOD, // LEGACY: report the real kind
            authorPubkey: mod.pubkey,
            title: mod.title,
            hashes: mod.downloads.map((d) => d.hash).filter((h): h is string => !!h),
          }}
        />
      )}
    </div>
  )
}
