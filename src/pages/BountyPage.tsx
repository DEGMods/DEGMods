import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { toast } from 'sonner'
import {
  BarChart3, Gamepad2, Gift, Loader2, CheckCircle2, CircleDashed, Pencil, Trash2,
  MoreHorizontal, FileUp, Trophy, ChevronLeft,
} from 'lucide-react'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CollapsibleMarkdown } from '@/components/mod/CollapsibleMarkdown'
import { PublisherCard } from '@/components/mod/PublisherCard'
import { CommentSection } from '@/components/social/CommentSection'
import { ShareBox } from '@/components/mod/ShareBox'
import { RequestDeleteDialog } from '@/components/shared/RequestDeleteDialog'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import type { NostrTarget } from '@/lib/nostr/social'
import { cn } from '@/lib/utils'

const fmt = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

interface Fulfillment { event: NostrEvent; title: string; naddr: string; pubkey: string; coordinate: string }

function bountyToForm(b: BountyDetails, previousCreatedAt: number): BountyFormState {
  return {
    dTag: b.dTag, isEdit: true, previousCreatedAt, publishedAt: b.publishedAt,
    title: b.title, featuredImageUrl: b.image, summary: b.summary, content: b.content, game: b.game,
    tags: b.tags, reward: b.reward ?? { what: '', how: '' },
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
  const [fulfillments, setFulfillments] = useState<Fulfillment[]>([])
  const [savingWinner, setSavingWinner] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  useSeoMeta(bounty ? { title: `${bounty.title} — mod bounty`, description: bounty.summary || bounty.content, image: bounty.image, type: 'article' } : null)

  // Load the bounty.
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

  // Cooperative rebroadcast + load fulfilments once we have the bounty.
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
      const list: Fulfillment[] = []
      for (const ev of evs) {
        if (!isValidFulfillment(ev, bounty)) continue
        const coord = modCoordinate(ev)
        if (!coord || seen.has(coord)) continue
        seen.add(coord)
        const data = extractModData(ev)
        list.push({ event: ev, title: data.title || 'Untitled mod', naddr: nip19.naddrEncode({ kind: KINDS.MOD, pubkey: ev.pubkey, identifier: data.dTag }), pubkey: ev.pubkey, coordinate: coord })
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
        if (s === 'publishing') toast.loading('Saving…', { id: 'winner' })
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

  if (loading) return <div className="flex items-center justify-center py-24 text-neutral-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading bounty…</div>
  if (notFound || !bounty) return <div className="py-24 text-center text-neutral-400">Mod bounty not found.</div>

  const isAuthor = myPubkey === bounty.pubkey
  const target: NostrTarget = { id: bounty.id, pubkey: bounty.pubkey, kind: KINDS.BOUNTY, aTag: bounty.aTag }

  return (
    <div className="py-6">
      <Link to="/mod-bounties" className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-400 transition-colors hover:text-white">
        <ChevronLeft size={16} /> Mod Bounties
      </Link>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Main */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {bounty.image && (
            <div className="relative aspect-video overflow-hidden rounded-xl border border-[#262626]">
              <SkeletonImage src={bounty.image} alt={bounty.title} className="h-full w-full object-cover" />
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[#fc4462]">
              <Gamepad2 className="h-4 w-4" /> <span>{bounty.game}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-3xl font-bold text-white">{bounty.title}</h1>
              {isAuthor && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="shrink-0 text-neutral-400 hover:bg-[#262626] hover:text-white"><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="border-[#262626] bg-[#1c1c1c]">
                    <DropdownMenuItem onClick={() => navigate(`/mod-bounty/${bounty.naddr}/edit`)} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" /> Edit bounty</DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-[#262626]" />
                    <DropdownMenuItem onClick={() => setShowDelete(true)} className="cursor-pointer text-red-400 focus:text-red-400"><Trash2 className="mr-2 h-4 w-4" /> Request Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Status band */}
            <div className={cn('flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-semibold', bounty.fulfilled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300')}>
              {bounty.fulfilled ? <CheckCircle2 className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
              {bounty.fulfilled ? 'Fulfilled' : 'Open — looking for a modder'}
            </div>

            {bounty.reward && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-2.5">
                <Gift className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-200">{bounty.reward.what}</span>
                {bounty.reward.how && <span className="text-sm text-neutral-400">· {bounty.reward.how}</span>}
              </div>
            )}
          </div>

          {bounty.content && <CollapsibleMarkdown content={bounty.content} />}

          {/* Fulfilments */}
          <section className="space-y-3 rounded-xl border border-[#262626] bg-[#1c1c1c] p-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><FileUp className="h-4 w-4 text-neutral-400" /> Fulfilments {fulfillments.length > 0 && <span className="text-sm font-normal text-neutral-500">({fulfillments.length})</span>}</h2>
            {fulfillments.length === 0 ? (
              <p className="text-sm text-neutral-500">No mods submitted for this bounty yet. Made one? Link it from your mod’s editor (“Fulfils a bounty”).</p>
            ) : (
              <ul className="space-y-2">
                {fulfillments.map((f) => {
                  const isWinner = bounty.winnerCoordinate === f.coordinate
                  return (
                    <li key={f.coordinate} className={cn('flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5', isWinner ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-[#262626] bg-[#212121]')}>
                      <Link to={`/mod/${f.naddr}`} className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium text-neutral-100 hover:text-white">
                          {isWinner && <Trophy className="h-4 w-4 shrink-0 text-emerald-400" />}
                          <span className="truncate">{f.title}</span>
                        </span>
                      </Link>
                      {isAuthor && (
                        isWinner ? (
                          <Button variant="outline" size="sm" disabled={savingWinner} onClick={() => setWinner(null, null)} className="shrink-0 border-[#262626] text-xs">Unmark</Button>
                        ) : (
                          <Button size="sm" disabled={savingWinner} onClick={() => setWinner(f.coordinate, f.pubkey)} className="shrink-0 bg-emerald-600 text-xs text-white hover:bg-emerald-500">Pick as fulfiller</Button>
                        )
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <PublisherCard pubkey={bounty.pubkey} />

          <div className="space-y-2 rounded-xl border border-[#262626] bg-[#1c1c1c] p-3">
            <Button onClick={() => navigate(`/submit-mod?bounty=${bounty.naddr}`)} className="w-full gap-2 bg-[#fc4462] text-white hover:bg-[#e23a56]">
              <FileUp className="h-4 w-4" /> Fulfil this bounty
            </Button>
            <p className="px-1 text-[11px] text-neutral-500">Publishes a new mod for {bounty.game}, pre-linked to this bounty.</p>
          </div>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-neutral-200">Posted</h2>
            <p className="text-sm text-neutral-400">{fmt(bounty.publishedAt)}</p>
            {bounty.client && <p className="text-xs text-neutral-500">on {bounty.client}</p>}
          </section>

          {naddr && <ShareBox url={`${window.location.origin}/mod-bounty/${bounty.naddr}`} title={bounty.title} />}
        </div>
      </div>

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
          noun="mod bounty"
          onDeleted={() => navigate('/mod-bounties')}
        />
      )}
    </div>
  )
}
