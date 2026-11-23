import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { toast } from 'sonner'
import { HandCoins, Gift, Plus, Pencil, Trash2, Loader2, User, ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { signAndPublish } from '@/lib/nostr/publish'
import { KINDS } from '@/lib/constants'
import {
  buildBountyPledgeEvent, constructPledgeListFromEvents,
  type BountyPledge, type BountyPledgeFormState,
} from '@/lib/nostr/bounty'
import { ACCENTS, type Accent } from '@/components/shared/accent'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CharCounter } from '@/components/shared/CharCounter'
import { Pagination } from '@/components/shared/Pagination'
import { RequestDeleteDialog } from '@/components/shared/RequestDeleteDialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const LIMITS = { what: 120, how: 160, message: 500 }
const BATCH = 30
const PER_PAGE = 10
const inputClass = 'bg-[#212121] border-[#262626] text-neutral-200 placeholder:text-neutral-600'

/**
 * Progressive fetch for a request's pledges: `loadMore()` pulls older events via
 * an `until` cursor (like useProgressiveEvents), and `reload()` re-pulls the
 * newest batch so a just-published or withdrawn pledge shows immediately.
 */
function usePledgeEvents(bountyCoordinate: string) {
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reachedEnd, setReachedEnd] = useState(false)
  const seenRef = useRef<Set<string>>(new Set())
  const oldestRef = useRef<number | undefined>(undefined)
  const inFlightRef = useRef(false)

  const baseFilter = useCallback(() => ({ kinds: [KINDS.BOUNTY_REWARD], '#a': [bountyCoordinate] }), [bountyCoordinate])

  const ingest = useCallback((evs: NostrEvent[]): number => {
    let fresh = 0
    const add: NostrEvent[] = []
    for (const e of evs) {
      if (seenRef.current.has(e.id)) continue
      seenRef.current.add(e.id)
      add.push(e)
      fresh++
      if (oldestRef.current === undefined || e.created_at < oldestRef.current) oldestRef.current = e.created_at
    }
    if (add.length) setEvents((prev) => [...prev, ...add].sort((a, b) => b.created_at - a.created_at))
    return fresh
  }, [])

  const reload = useCallback(async () => {
    seenRef.current = new Set()
    oldestRef.current = undefined
    setEvents([])
    setReachedEnd(false)
    setLoading(true)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    try {
      const evs = await fetchEvents(relays, { ...baseFilter(), limit: BATCH }, 8000)
      ingest(evs)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [baseFilter, ingest])

  useEffect(() => { reload() }, [reload])

  const loadMore = useCallback(async () => {
    if (inFlightRef.current || reachedEnd || oldestRef.current === undefined) return
    inFlightRef.current = true
    setLoadingMore(true)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    try {
      const evs = await fetchEvents(relays, { ...baseFilter(), until: oldestRef.current - 1, limit: BATCH }, 8000)
      if (ingest(evs) === 0) setReachedEnd(true)
    } catch { /* ignore */ } finally {
      inFlightRef.current = false
      setLoadingMore(false)
    }
  }, [reachedEnd, baseFilter, ingest])

  return { events, loading, loadingMore, reachedEnd, loadMore, reload }
}

/**
 * Third-party reward pledges on a mod request (kind 31244). Rendered inside the
 * Reward box as a single clickable count; the list (paginated, progressively
 * fetched) lives in a modal. Anyone logged in can add one editable pledge.
 */
export function BountyPledges({ bountyCoordinate, game, accent = 'orange' }: { bountyCoordinate: string; game: string; accent?: Accent }) {
  const a = ACCENTS[accent]
  const [open, setOpen] = useState(false)

  const { events, loading, loadingMore, reachedEnd, loadMore, reload } = usePledgeEvents(bountyCoordinate)
  const pledges = useMemo(() => constructPledgeListFromEvents(events, bountyCoordinate), [events, bountyCoordinate])
  const count = pledges.length

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-lg bg-[#212121] px-3 py-2 text-left transition-colors hover:bg-[#262626]"
      >
        <span className="flex items-center gap-1.5 text-sm text-neutral-300">
          <HandCoins className={cn('h-4 w-4', a.text)} />
          {loading && count === 0
            ? 'Reward pledges'
            : `${count}${!reachedEnd && count >= BATCH ? '+' : ''} reward pledge${count === 1 ? '' : 's'}`}
        </span>
        <ChevronRight className="h-4 w-4 text-neutral-500" />
      </button>

      <PledgesModal
        open={open}
        onOpenChange={setOpen}
        pledges={pledges}
        rawEvents={events}
        loading={loading}
        loadingMore={loadingMore}
        reachedEnd={reachedEnd}
        loadMore={loadMore}
        reload={reload}
        bountyCoordinate={bountyCoordinate}
        game={game}
        accent={accent}
      />
    </>
  )
}

function PledgesModal({
  open, onOpenChange, pledges, rawEvents, loading, loadingMore, reachedEnd, loadMore, reload,
  bountyCoordinate, game, accent,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  pledges: BountyPledge[]
  rawEvents: NostrEvent[]
  loading: boolean
  loadingMore: boolean
  reachedEnd: boolean
  loadMore: () => void
  reload: () => void
  bountyCoordinate: string
  game: string
  accent: Accent
}) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const isAuthed = useAuthStore((s) => s.isAuthenticated)
  const a = ACCENTS[accent]

  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<NostrEvent | null>(null)

  const myPledge = myPubkey ? pledges.find((p) => p.pubkey === myPubkey) ?? null : null

  const totalPages = Math.max(1, Math.ceil(pledges.length / PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const paginated = pledges.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE)

  // Prefetch an older batch as the user nears the last loaded page.
  useEffect(() => {
    if (open && !loading && !reachedEnd && currentPage >= totalPages - 1) loadMore()
  }, [open, currentPage, totalPages, reachedEnd, loading, loadMore])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col border-[#262626] bg-[#1c1c1c]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-neutral-100">
            <HandCoins className={cn('h-5 w-5', a.text)} /> Reward pledges
            {!loading && <span className="text-sm font-normal text-neutral-500">({pledges.length})</span>}
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            Extra rewards offered by others for whoever makes this mod. Descriptive only — nothing is held or paid through the app.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading && pledges.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          ) : pledges.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">No reward pledges yet.</p>
          ) : (
            <>
              <ul className="space-y-2">
                {paginated.map((p) => (
                  <PledgeRow
                    key={p.aTag}
                    pledge={p}
                    accent={accent}
                    isOwn={p.pubkey === myPubkey}
                    onEdit={() => setFormOpen(true)}
                    onDelete={() => { const ev = rawEvents.find((e) => e.id === p.id); if (ev) setDeleteTarget(ev) }}
                  />
                ))}
              </ul>
              <Pagination page={currentPage} totalPages={totalPages} onPage={setPage} reachedEnd={reachedEnd} loadingMore={loadingMore} />
            </>
          )}
        </div>

        <DialogFooter>
          {isAuthed ? (
            <Button onClick={() => setFormOpen(true)} className={cn('w-full gap-1.5 text-white', a.solid)}>
              {myPledge ? <><Pencil className="h-4 w-4" /> Edit your pledge</> : <><Plus className="h-4 w-4" /> Pledge a reward</>}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => useLoginModalStore.getState().open()} className="w-full border-[#262626]">
              Log in to pledge a reward
            </Button>
          )}
        </DialogFooter>

        <PledgeFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          bountyCoordinate={bountyCoordinate}
          game={game}
          existing={myPledge}
          accent={accent}
          onPublished={() => { setFormOpen(false); setPage(1); setTimeout(reload, 1000) }}
        />

        {deleteTarget && (
          <RequestDeleteDialog
            open={!!deleteTarget}
            onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}
            event={deleteTarget}
            title="your reward pledge"
            noun="reward pledge"
            onDeleted={() => { setDeleteTarget(null); setTimeout(reload, 1000) }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function PledgeRow({ pledge, accent, isOwn, onEdit, onDelete }: {
  pledge: BountyPledge; accent: Accent; isOwn: boolean; onEdit: () => void; onDelete: () => void
}) {
  const [author, setAuthor] = useState<UserProfile | null>(null)
  const a = ACCENTS[accent]

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(pledge.pubkey, relays).then((p) => { if (!cancelled) setAuthor(p) })
    return () => { cancelled = true }
  }, [pledge.pubkey])

  const npub = nip19.npubEncode(pledge.pubkey)
  const name = author?.display_name || `${npub.slice(0, 10)}…`

  return (
    <li className="rounded-lg border border-[#262626] bg-[#212121] p-3">
      <div className="flex items-center justify-between gap-2">
        <Link to={`/profile/${npub}`} className="flex min-w-0 items-center gap-2">
          <Avatar className="h-5 w-5 shrink-0">
            {author?.picture ? <AvatarImage src={author.picture} alt={name} /> : null}
            <AvatarFallback className="bg-[#1c1c1c] text-neutral-400"><User className="h-3 w-3" /></AvatarFallback>
          </Avatar>
          <span className="truncate text-xs text-neutral-300">{name}</span>
        </Link>
        {isOwn && (
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={onEdit} className="rounded p-1 text-neutral-500 transition-colors hover:bg-[#262626] hover:text-neutral-200" title="Edit your pledge"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={onDelete} className="rounded p-1 text-neutral-500 transition-colors hover:bg-[#262626] hover:text-red-400" title="Delete your pledge"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>
      <p className={cn('mt-2 flex items-start gap-1.5 text-sm', a.text)}>
        <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{pledge.reward.what}{pledge.reward.how ? <span className="text-neutral-400"> ({pledge.reward.how})</span> : null}</span>
      </p>
      {pledge.message && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-neutral-400">{pledge.message}</p>}
    </li>
  )
}

function PledgeFormDialog({ open, onOpenChange, bountyCoordinate, game, existing, accent, onPublished }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  bountyCoordinate: string
  game: string
  existing: BountyPledge | null
  accent: Accent
  onPublished: () => void
}) {
  const a = ACCENTS[accent]
  const [what, setWhat] = useState('')
  const [how, setHow] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  // Seed the fields each time the dialog opens (new pledge → blank; edit → prefill).
  useEffect(() => {
    if (!open) return
    setWhat(existing?.reward.what ?? '')
    setHow(existing?.reward.how ?? '')
    setMessage(existing?.message ?? '')
  }, [open, existing])

  const submit = async () => {
    if (!what.trim()) { toast.error('Describe the reward'); return }
    setSaving(true)
    const form: BountyPledgeFormState = {
      bountyCoordinate,
      game,
      reward: { what, how },
      message,
      isEdit: !!existing,
      previousCreatedAt: existing?.createdAt,
      publishedAt: existing?.publishedAt,
    }
    try {
      const res = await signAndPublish(buildBountyPledgeEvent(form), (s) => {
        if (s === 'publishing') toast.loading('Publishing pledge…', { id: 'pledge' })
      })
      if (!res.success) throw new Error(res.error || 'Failed to publish')
      toast.success(existing ? 'Pledge updated' : 'Reward pledged', { id: 'pledge' })
      onPublished()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish', { id: 'pledge' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#262626] bg-[#1c1c1c]">
        <DialogHeader>
          <DialogTitle className="text-neutral-100">{existing ? 'Edit your reward pledge' : 'Pledge a reward'}</DialogTitle>
          <DialogDescription className="text-neutral-400">
            Offer an extra reward for whoever makes this mod. Descriptive only — nothing is held or paid through the app.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">What</label>
            <Input value={what} onChange={(e) => setWhat(e.target.value)} maxLength={LIMITS.what} placeholder="e.g. $50" className={inputClass} />
            <CharCounter value={what} max={LIMITS.what} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">How <span className="text-neutral-600">(optional)</span></label>
            <Input value={how} onChange={(e) => setHow(e.target.value)} maxLength={LIMITS.how} placeholder="How will you deliver this?" className={inputClass} />
            <CharCounter value={how} max={LIMITS.how} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">Note <span className="text-neutral-600">(optional)</span></label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={LIMITS.message} rows={3} placeholder="Any conditions or details…" className={cn(inputClass, 'resize-y')} />
            <CharCounter value={message} max={LIMITS.message} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[#262626]">Cancel</Button>
          <Button onClick={submit} disabled={saving} className={cn(a.solid, 'text-white')}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {existing ? 'Save pledge' : 'Publish pledge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
