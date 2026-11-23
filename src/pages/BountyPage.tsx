import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { toast } from 'sonner'
import {
  Gamepad2, Gift, Loader2, CircleDashed, Pencil, Trash2, MoreHorizontal,
  FileUp, ChevronLeft, Copy, FileJson, AlertTriangle,
} from 'lucide-react'
import { useNsfwReveal } from '@/hooks/useNsfwReveal'
import { KINDS } from '@/lib/constants'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchLatestEvent, fetchEvents } from '@/lib/nostr/relay-pool'
import { signAndPublish } from '@/lib/nostr/publish'
import { extractModData } from '@/lib/nostr/events'
import {
  extractBounty, buildBountyEvent, bountyCoordinateFromNaddr, isValidFulfillment, modCoordinate,
  type BountyDetails, type BountyFormState,
} from '@/lib/nostr/bounty'
import { useSeoMeta } from '@/hooks/useSeoMeta'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { CollapsibleMarkdown } from '@/components/mod/CollapsibleMarkdown'
import { ModCard } from '@/components/mod/ModCard'
import { PublisherCard } from '@/components/mod/PublisherCard'
import { CommentSection } from '@/components/social/CommentSection'
import { ShareBox } from '@/components/mod/ShareBox'
import { RequestDeleteDialog } from '@/components/shared/RequestDeleteDialog'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { Pagination } from '@/components/shared/Pagination'
import type { NostrTarget } from '@/lib/nostr/social'
import type { ModDetails } from '@/types/mod'
import { cn } from '@/lib/utils'

const fmt = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const PER_PAGE = 6

function bountyToForm(b: BountyDetails, previousCreatedAt: number): BountyFormState {
  return {
    dTag: b.dTag, isEdit: true, previousCreatedAt, publishedAt: b.publishedAt,
    title: b.title, featuredImageUrl: b.image, summary: b.summary, content: b.content, game: b.game,
    tags: b.tags, contentWarning: !!b.contentWarning, contentWarningReason: b.contentWarning || '',
    reward: b.reward ?? { what: '', how: '' },
    winnerCoordinate: b.winnerCoordinate, winnerPubkey: b.winnerPubkey,
  }
}

export function BountyPage() {
  const { naddr } = useParams<{ naddr: string }>()
  const navigate = useNavigate()
  const myPubkey = useAuthStore((s) => s.pubkey)

  const [bounty, setBounty] = useState<BountyDetails | null>(null)
  const [rawEvent, setRawEvent] = useState<NostrEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [fulfillments, setFulfillments] = useState<ModDetails[]>([])
  const [savingWinner, setSavingWinner] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [page, setPage] = useState(1)
  const { revealed, reveal } = useNsfwReveal()

  useSeoMeta(bounty ? { title: `${bounty.title} - mod request`, description: bounty.summary || bounty.content, image: bounty.image, type: 'article' } : null)

  // Load the request.
  useEffect(() => {
    if (!naddr) return
    let cancelled = false
    setLoading(true); setNotFound(false)
    ;(async () => {
      const coord = bountyCoordinateFromNaddr(naddr)
      if (!coord) { if (!cancelled) { setNotFound(true); setLoading(false) } return }
      const [, pubkey, ...idParts] = coord.split(':')
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      try {
        const ev = await fetchLatestEvent(relays, { kinds: [KINDS.BOUNTY], authors: [pubkey], '#d': [idParts.join(':')] })
        if (cancelled) return
        const b = ev ? extractBounty(ev) : null
        if (!b || !ev) { setNotFound(true); setLoading(false); return }
        setBounty(b); setRawEvent(ev); setLoading(false)
      } catch {
        if (!cancelled) { setNotFound(true); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [naddr])

  // Cooperative rebroadcast + load fulfilments once we have the request.
  useEffect(() => {
    if (!bounty || !rawEvent) return
    let cancelled = false
    const t = setTimeout(() => {
      import('@/lib/nostr/eventRedundancy').then(({ ensureEventPresent }) => ensureEventPresent(rawEvent))
    }, 8000)
    ;(async () => {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const evs = await fetchEvents(relays, { kinds: [KINDS.MOD], '#a': [bounty.aTag] })
      if (cancelled) return
      const seen = new Set<string>()
      const list: ModDetails[] = []
      // Newest first, so a coordinate's latest edit is the one we keep.
      for (const ev of [...evs].sort((a, b) => b.created_at - a.created_at)) {
        if (!isValidFulfillment(ev, bounty)) continue
        const coord = modCoordinate(ev)
        if (!coord || seen.has(coord)) continue
        seen.add(coord)
        list.push(extractModData(ev))
      }
      setFulfillments(list)
    })()
    return () => { cancelled = true; clearTimeout(t) }
  }, [bounty, rawEvent])

  const setWinner = useCallback(async (coordinate: string | null, pubkey: string | null) => {
    if (!bounty || !rawEvent) return
    setSavingWinner(true)
    try {
      const form = { ...bountyToForm(bounty, rawEvent.created_at), winnerCoordinate: coordinate, winnerPubkey: pubkey }
      const result = await signAndPublish(buildBountyEvent(form), (s) => {
        if (s === 'publishing') toast.loading('Saving...', { id: 'winner' })
      })
      if (!result.success || !result.event) throw new Error(result.error || 'Failed to save')
      setRawEvent(result.event)
      setBounty(extractBounty(result.event))
      toast.success(coordinate ? 'Marked as fulfilled' : 'Cleared the fulfiller', { id: 'winner' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save', { id: 'winner' })
    } finally {
      setSavingWinner(false)
    }
  }, [bounty, rawEvent])

  const totalPages = Math.max(1, Math.ceil(fulfillments.length / PER_PAGE))
  const paginated = useMemo(() => fulfillments.slice((page - 1) * PER_PAGE, page * PER_PAGE), [fulfillments, page])
  const winnerFulfillment = bounty?.winnerCoordinate ? fulfillments.find((f) => f.aTag === bounty.winnerCoordinate) : undefined

  if (loading) return <div className="flex items-center justify-center py-24 text-neutral-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading request...</div>
  if (notFound || !bounty) return <div className="py-24 text-center text-neutral-400">Mod request not found.</div>

  const isAuthor = myPubkey === bounty.pubkey
  const hasWarning = !!bounty.contentWarning && !revealed
  const target: NostrTarget = { id: bounty.id, pubkey: bounty.pubkey, kind: KINDS.BOUNTY, aTag: bounty.aTag }
  const copyNaddr = () => { navigator.clipboard.writeText(nip19.naddrEncode({ kind: KINDS.BOUNTY, pubkey: bounty.pubkey, identifier: bounty.dTag })); toast.success('Note ID copied to clipboard') }
  const copyNpub = () => { navigator.clipboard.writeText(nip19.npubEncode(bounty.pubkey)); toast.success('Author npub copied to clipboard') }

  return (
    <div className="space-y-6 py-6">
      <Link to="/mod-bounties" className="inline-flex items-center gap-1.5 text-sm text-neutral-400 transition-colors hover:text-white">
        <ChevronLeft size={16} /> Mod Requests
      </Link>

      {/* Title area */}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-100">{bounty.title}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0 text-neutral-400 hover:bg-[#262626] hover:text-white"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-[#262626] bg-[#1c1c1c]">
            <DropdownMenuItem onClick={copyNaddr} className="cursor-pointer"><Copy className="mr-2 h-4 w-4" /> Copy Note ID</DropdownMenuItem>
            <DropdownMenuItem onClick={copyNpub} className="cursor-pointer"><Copy className="mr-2 h-4 w-4" /> Copy Author npub</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowRaw(true)} className="cursor-pointer"><FileJson className="mr-2 h-4 w-4" /> View Raw Event</DropdownMenuItem>
            {isAuthor && (
              <>
                <DropdownMenuSeparator className="bg-[#262626]" />
                <DropdownMenuItem onClick={() => navigate(`/mod-bounty/${bounty.naddr}/edit`)} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" /> Edit request</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowDelete(true)} className="cursor-pointer text-red-400 focus:text-red-400"><Trash2 className="mr-2 h-4 w-4" /> Request Delete</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Separator className="bg-[#262626]" />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Main */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <div className="relative aspect-video overflow-hidden rounded-xl border border-[#262626] bg-[#212121]">
            {bounty.image ? (
              <>
                <SkeletonImage src={bounty.image} alt={bounty.title} className={cn('h-full w-full object-cover', hasWarning && 'blur-2xl')} />
                {hasWarning && (
                  <button onClick={() => reveal()} className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/60 text-neutral-300">
                    <AlertTriangle className="h-7 w-7 text-yellow-500" />
                    <span className="text-sm font-medium">{bounty.contentWarning}</span>
                    <span className="text-xs text-neutral-500">Click to reveal</span>
                  </button>
                )}
              </>
            ) : (
              <img src="/hub-banner-placeholder.jpg" alt="" className="h-full w-full object-cover" />
            )}
          </div>

          {bounty.content && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-neutral-200">About</h2>
                <Link to={`/game/${encodeURIComponent(bounty.game)}`} className="w-fit">
                  <Badge variant="outline" className="cursor-pointer border-purple-500/40 text-purple-400 transition-colors hover:bg-purple-500/10">
                    <Gamepad2 className="mr-1 h-3 w-3" /> {bounty.game}
                  </Badge>
                </Link>
              </div>
              <CollapsibleMarkdown content={bounty.content} />
            </section>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <PublisherCard pubkey={bounty.pubkey} />

          {/* Status + chosen fulfiller */}
          <section className="space-y-3">
            <div className={cn('flex items-center gap-2 text-sm font-semibold', bounty.fulfilled ? 'text-emerald-300' : 'text-amber-300')}>
              {!bounty.fulfilled && <CircleDashed className="h-4 w-4" />}
              {bounty.fulfilled ? 'Mod request fulfilled' : 'Open, looking for a modder'}
            </div>

            {bounty.fulfilled && (
              <div className="space-y-2">
                {winnerFulfillment ? <ModCard mod={winnerFulfillment} /> : (
                  <p className="text-sm text-neutral-400">A fulfiller has been selected.</p>
                )}
                {isAuthor && (
                  <Button variant="ghost" size="sm" disabled={savingWinner} onClick={() => setWinner(null, null)} className="w-full text-xs text-neutral-400 hover:bg-[#262626] hover:text-white">Unmark as fulfilled</Button>
                )}
              </div>
            )}
          </section>

          {/* Reward */}
          {bounty.reward && (
            <section className="space-y-1 rounded-xl border border-[#262626] bg-[#1c1c1c] p-4">
              <p className="text-xs font-medium text-neutral-400">Reward</p>
              <p className="flex items-start gap-1.5 text-sm text-emerald-300">
                <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{bounty.reward.what}{bounty.reward.how ? <span className="text-neutral-400"> ({bounty.reward.how})</span> : null}</span>
              </p>
            </section>
          )}

          <div className="space-y-2 rounded-xl border border-[#262626] bg-[#1c1c1c] p-3">
            <Button onClick={() => navigate(`/submit-mod?bounty=${bounty.naddr}`)} className="w-full gap-2 bg-purple-600 text-white hover:bg-purple-700">
              <FileUp className="h-4 w-4" /> Fulfil this request
            </Button>
            <p className="px-1 text-[11px] text-neutral-500">Publishes a new mod for {bounty.game}, pre-linked to this request.</p>
          </div>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-neutral-200">Published</h2>
            <p className="text-sm text-neutral-400">{fmt(bounty.publishedAt)}</p>
            {bounty.updatedAt && <p className="text-xs text-neutral-500">Edited {fmt(bounty.updatedAt)}</p>}
            {bounty.client && <p className="text-xs text-neutral-500">on {bounty.client}</p>}
          </section>

          {naddr && <ShareBox url={`${window.location.origin}/mod-bounty/${bounty.naddr}`} title={bounty.title} />}
        </div>
      </div>

      {/* Fulfilments (full width, like comments) */}
      <section className="mt-8 space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-200">
          <FileUp className="h-4 w-4 text-neutral-400" /> Fulfilments
          {fulfillments.length > 0 && <span className="text-sm font-normal text-neutral-500">({fulfillments.length})</span>}
        </h2>
        {fulfillments.length === 0 ? (
          <p className="text-sm text-neutral-500">No mods submitted for this request yet. Made one? Link it from your mod&rsquo;s editor (&ldquo;Fulfils a mod request&rdquo;).</p>
        ) : (
          <>
            <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {paginated.map((f) => (
                <li key={f.aTag} className="flex h-full flex-col gap-2">
                  <div className="flex-1"><ModCard mod={f} /></div>
                  {isAuthor && bounty.winnerCoordinate !== f.aTag && (
                    <Button size="sm" disabled={savingWinner} onClick={() => setWinner(f.aTag, f.pubkey)} className="w-full bg-emerald-600 text-xs text-white hover:bg-emerald-500">Pick as fulfiller</Button>
                  )}
                </li>
              ))}
            </ol>
            <Pagination page={page} totalPages={totalPages} onPage={setPage} />
          </>
        )}
      </section>

      {/* Comments */}
      <div className="mt-8">
        <CommentSection root={target} />
      </div>

      {rawEvent && (
        <RequestDeleteDialog
          open={showDelete}
          onOpenChange={setShowDelete}
          event={rawEvent as unknown as Parameters<typeof RequestDeleteDialog>[0]['event']}
          title={bounty.title}
          noun="mod request"
          onDeleted={() => navigate('/mod-bounties')}
        />
      )}

      {/* Raw event dialog */}
      <Dialog open={showRaw} onOpenChange={setShowRaw}>
        <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-neutral-100"><FileJson className="h-5 w-5 text-purple-400" /> Raw Event</DialogTitle>
            <DialogDescription className="text-neutral-400">The raw Nostr event data for this mod request.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded-lg border border-[#262626] bg-[#171717] p-4">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-neutral-300"><code>{rawEvent ? JSON.stringify(rawEvent, null, 2) : ''}</code></pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { if (rawEvent) { navigator.clipboard.writeText(JSON.stringify(rawEvent, null, 2)); toast.success('Raw JSON copied to clipboard') } }} className="border-[#262626]"><Copy className="mr-2 h-4 w-4" /> Copy JSON</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
