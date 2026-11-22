import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { toast } from 'sonner'
import { Loader2, Plus, X } from 'lucide-react'
import { KINDS, IMAGE_UPLOAD_ACCEPT } from '@/lib/constants'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { signAndPublish } from '@/lib/nostr/publish'
import {
  buildBountyEvent, extractBounty, bountyCoordinateFromNaddr,
  type BountyFormState,
} from '@/lib/nostr/bounty'
import { GameAutocomplete } from '@/components/shared/GameAutocomplete'
import { BlossomUploadField } from '@/components/upload/BlossomUploadField'
import { RequiredDot } from '@/components/shared/RequiredDot'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { CharCounter } from '@/components/shared/CharCounter'
import { cn } from '@/lib/utils'

// Per-field caps. The worst case (every field full) stays well under the 64 KB
// event ceiling, so a request can never grow into an unpublishable event.
const LIMITS = { title: 100, game: 100, summary: 300, image: 300, rewardWhat: 120, rewardHow: 160, content: 10000, tag: 30 }
const MAX_TAGS = 20

const inputClass = 'bg-[#212121] border-[#262626] text-neutral-200 placeholder:text-neutral-600 focus-visible:ring-purple-500/40 focus-visible:border-purple-500/50'

function emptyForm(): BountyFormState {
  return {
    dTag: crypto.randomUUID(),
    title: '', featuredImageUrl: '', summary: '', content: '', game: '',
    tags: [], reward: { what: '', how: '' },
    winnerCoordinate: null, winnerPubkey: null,
  }
}

/** Create or edit a mod request. Edit mode is driven by the `:naddr` route param. */
export function SubmitBountyPage() {
  const navigate = useNavigate()
  const { naddr } = useParams<{ naddr: string }>()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const pubkey = useAuthStore((s) => s.pubkey)

  const [form, setForm] = useState<BountyFormState>(emptyForm)
  const [loading, setLoading] = useState(!!naddr)
  const [publishing, setPublishing] = useState(false)
  const isEdit = !!naddr

  const set = useCallback(<K extends keyof BountyFormState>(key: K, value: BountyFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
  }, [])

  // Edit mode: load the existing request and populate the form (preserving the
  // winner selection so a full-form edit never silently clears it).
  useEffect(() => {
    if (!naddr) return
    let cancelled = false
    ;(async () => {
      const coord = bountyCoordinateFromNaddr(naddr)
      if (!coord) { toast.error('Invalid request address'); navigate('/mod-bounties'); return }
      const [, authorPk, ...idParts] = coord.split(':')
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const ev = await fetchLatestEvent(relays, { kinds: [KINDS.BOUNTY], authors: [authorPk], '#d': [idParts.join(':')] })
      if (cancelled) return
      const b = ev ? extractBounty(ev) : null
      if (!b || !ev) { toast.error('Mod request not found'); navigate('/mod-bounties'); return }
      if (b.pubkey !== pubkey) { toast.error('You can only edit your own requests'); navigate(`/mod-bounty/${naddr}`); return }
      setForm({
        dTag: b.dTag, isEdit: true, previousCreatedAt: ev.created_at, publishedAt: b.publishedAt,
        title: b.title, featuredImageUrl: b.image, summary: b.summary, content: b.content, game: b.game,
        tags: b.tags, reward: b.reward ?? { what: '', how: '' },
        winnerCoordinate: b.winnerCoordinate, winnerPubkey: b.winnerPubkey,
      })
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [naddr, navigate, pubkey])

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <h1 className="text-xl font-semibold text-white">Login Required</h1>
        <p className="text-sm text-neutral-400">You need to be logged in to post a mod request.</p>
        <button onClick={() => useLoginModalStore.getState().open()} className="cursor-pointer text-sm text-purple-400 underline-offset-2 hover:text-purple-300 hover:underline">Go to Login</button>
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center py-24 text-neutral-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading request...</div>

  const publish = async () => {
    if (!form.title.trim()) { toast.error('A title is required'); return }
    if (!form.game.trim()) { toast.error('Pick the game this mod is wanted for'); return }
    setPublishing(true)
    try {
      const result = await signAndPublish(buildBountyEvent(form), (status) => {
        if (status === 'mining') toast.loading('Processing proof of work...', { id: 'bounty' })
        if (status === 'signing') toast.loading('Signing...', { id: 'bounty' })
        if (status === 'publishing') toast.loading('Publishing...', { id: 'bounty' })
      })
      if (!result.success) throw new Error(result.error || 'Failed to publish')
      toast.success(isEdit ? 'Mod request updated' : 'Mod request posted', { id: 'bounty' })
      const addr = nip19.naddrEncode({ identifier: form.dTag, pubkey: pubkey!, kind: KINDS.BOUNTY })
      navigate(`/mod-bounty/${addr}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'bounty' })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="py-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{isEdit ? 'Edit mod request' : 'Post a mod request'}</h1>
        <p className="mt-1 text-sm text-neutral-400">Request a mod that doesn&rsquo;t exist yet. Describe what you want, for which game, and (optionally) a reward.</p>
      </div>

      <div className="space-y-6">
        <Field label="Title" incomplete={!form.title.trim()}>
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={LIMITS.title} placeholder="e.g. First-person camera for vehicles" className={inputClass} />
          <CharCounter value={form.title} max={LIMITS.title} />
        </Field>

        <Field label="Game" incomplete={!form.game.trim()} hint="The game this mod is wanted for.">
          <GameAutocomplete value={form.game} onChange={(v) => set('game', v)} maxLength={LIMITS.game} className={inputClass} />
        </Field>

        <Field label="Summary" hint="Optional short line for listings.">
          <Input value={form.summary} onChange={(e) => set('summary', e.target.value)} maxLength={LIMITS.summary} placeholder="One-line summary" className={inputClass} />
          <CharCounter value={form.summary} max={LIMITS.summary} />
        </Field>

        <Field label="Featured image" hint="Optional. Paste a URL or upload one.">
          <div className="space-y-3">
            <Input value={form.featuredImageUrl} onChange={(e) => set('featuredImageUrl', e.target.value)} maxLength={LIMITS.image} placeholder="Image URL (https://...)" className={inputClass} />
            <CharCounter value={form.featuredImageUrl} max={LIMITS.image} />
            <div className="flex items-center gap-3">
              <Separator className="flex-1 bg-[#262626]" />
              <span className="text-xs uppercase tracking-wider text-neutral-600">or upload</span>
              <Separator className="flex-1 bg-[#262626]" />
            </div>
            <BlossomUploadField
              accept={IMAGE_UPLOAD_ACCEPT}
              label="Drop image here or click to browse"
              sublabel="JPG, PNG, WebP, GIF, AVIF · mirrored to up to 3 servers"
              onUploaded={(r) => set('featuredImageUrl', r.url)}
            />
            {form.featuredImageUrl && (
              <div className="overflow-hidden rounded-lg border border-[#262626]">
                <img src={form.featuredImageUrl} alt="Featured preview" className="max-h-64 w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              </div>
            )}
          </div>
        </Field>

        <Field label="Description" incomplete={!form.content.trim()} hint="Markdown supported. What the mod should do and why.">
          <Textarea value={form.content} onChange={(e) => set('content', e.target.value)} maxLength={LIMITS.content} rows={8} placeholder="Describe the mod you want..." className={inputClass} />
          <CharCounter value={form.content} max={LIMITS.content} />
        </Field>

        <Field label="Reward" hint="Optional. What you're offering, and how you'll deliver it.">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Input value={form.reward.what} onChange={(e) => set('reward', { ...form.reward, what: e.target.value })} maxLength={LIMITS.rewardWhat} placeholder="What (e.g. $100)" className={inputClass} />
              <CharCounter value={form.reward.what} max={LIMITS.rewardWhat} />
            </div>
            <div>
              <Input value={form.reward.how} onChange={(e) => set('reward', { ...form.reward, how: e.target.value })} maxLength={LIMITS.rewardHow} placeholder="How will you deliver this?" className={inputClass} />
              <CharCounter value={form.reward.how} max={LIMITS.rewardHow} />
            </div>
          </div>
        </Field>

        <Field label="Tags" hint="Optional.">
          <ChipInput items={form.tags} onChange={(v) => set('tags', v)} placeholder="Add a tag and press Enter" maxLength={LIMITS.tag} max={MAX_TAGS} />
        </Field>

        <Button onClick={publish} disabled={publishing} className="w-full bg-purple-600 text-white hover:bg-purple-700">
          {publishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEdit ? 'Update request' : 'Post request'}
        </Button>
      </div>
    </div>
  )
}

function Field({ label, incomplete, hint, children }: { label: string; incomplete?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-200">
        {label}{incomplete && <RequiredDot />}
      </label>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      {children}
    </div>
  )
}

/** Chip-list tag input: type + Enter (or the Add button) to add, click × to remove. */
function ChipInput({ items, onChange, placeholder, maxLength, max }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; maxLength: number; max: number }) {
  const [val, setVal] = useState('')
  const full = items.length >= max
  const add = () => {
    if (full) return
    const v = val.trim().toLowerCase()
    if (v && !items.includes(v)) onChange([...items, v])
    setVal('')
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} placeholder={placeholder} maxLength={maxLength} disabled={full} className={inputClass} />
        <Button type="button" variant="outline" className="shrink-0 border-[#262626]" onClick={add} disabled={full}><Plus className="h-4 w-4" /></Button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <span key={it} className="inline-flex items-center gap-1 rounded-md bg-[#262626] px-2 py-0.5 text-xs text-neutral-200">
              {it}
              <button type="button" onClick={() => onChange(items.filter((x) => x !== it))} className="text-neutral-500 hover:text-red-400"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-end gap-3">
        <CharCounter value={val} max={maxLength} />
        <span className={cn('text-[10px] tabular-nums', items.length >= max ? 'text-amber-400' : 'text-neutral-600')}>{items.length}/{max}</span>
      </div>
    </div>
  )
}
