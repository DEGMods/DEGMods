import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { toast } from 'sonner'
import { Loader2, BarChart3 } from 'lucide-react'
import { KINDS } from '@/lib/constants'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { CharCounter } from '@/components/shared/CharCounter'
import { cn } from '@/lib/utils'

const LIMITS = { title: 100, game: 100, summary: 300, image: 300, rewardWhat: 120, rewardHow: 160, content: 20000, tag: 30 }

const inputClass = 'bg-[#212121] border-[#262626] text-neutral-200 placeholder:text-neutral-600 focus-visible:ring-purple-500/40 focus-visible:border-purple-500/50'

function emptyForm(): BountyFormState {
  return {
    dTag: crypto.randomUUID(),
    title: '', featuredImageUrl: '', summary: '', content: '', game: '',
    tags: [], reward: { what: '', how: '' },
    winnerCoordinate: null, winnerPubkey: null,
  }
}

/** Create or edit a mod bounty. Edit mode is driven by the `:naddr` route param. */
export function SubmitBountyPage() {
  const navigate = useNavigate()
  const { naddr } = useParams<{ naddr: string }>()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const pubkey = useAuthStore((s) => s.pubkey)

  const [form, setForm] = useState<BountyFormState>(emptyForm)
  const [tagsText, setTagsText] = useState('')
  const [loading, setLoading] = useState(!!naddr)
  const [publishing, setPublishing] = useState(false)
  const isEdit = !!naddr

  const set = useCallback(<K extends keyof BountyFormState>(key: K, value: BountyFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
  }, [])

  // Edit mode: load the existing bounty and populate the form (preserving the
  // winner selection so a full-form edit never silently clears it).
  useEffect(() => {
    if (!naddr) return
    let cancelled = false
    ;(async () => {
      const coord = bountyCoordinateFromNaddr(naddr)
      if (!coord) { toast.error('Invalid bounty address'); navigate('/mod-bounties'); return }
      const [, authorPk, ...idParts] = coord.split(':')
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const ev = await fetchLatestEvent(relays, { kinds: [KINDS.BOUNTY], authors: [authorPk], '#d': [idParts.join(':')] })
      if (cancelled) return
      const b = ev ? extractBounty(ev) : null
      if (!b || !ev) { toast.error('Bounty not found'); navigate('/mod-bounties'); return }
      if (b.pubkey !== pubkey) { toast.error("You can only edit your own bounties"); navigate(`/mod-bounty/${naddr}`); return }
      setForm({
        dTag: b.dTag, isEdit: true, previousCreatedAt: ev.created_at, publishedAt: b.publishedAt,
        title: b.title, featuredImageUrl: b.image, summary: b.summary, content: b.content, game: b.game,
        tags: b.tags, reward: b.reward ?? { what: '', how: '' },
        winnerCoordinate: b.winnerCoordinate, winnerPubkey: b.winnerPubkey,
      })
      setTagsText(b.tags.join(', '))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [naddr, navigate, pubkey])

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <h1 className="text-xl font-semibold text-white">Login Required</h1>
        <p className="text-sm text-neutral-400">You need to be logged in to post a mod bounty.</p>
        <button onClick={() => useLoginModalStore.getState().open()} className="cursor-pointer text-sm text-purple-400 underline-offset-2 hover:text-purple-300 hover:underline">Go to Login</button>
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center py-24 text-neutral-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading bounty…</div>

  const publish = async () => {
    if (!form.title.trim()) { toast.error('A title is required'); return }
    if (!form.game.trim()) { toast.error('Pick the game this mod is wanted for'); return }
    setPublishing(true)
    try {
      const tags = tagsText.split(',').map((s) => s.trim().slice(0, LIMITS.tag)).filter(Boolean).slice(0, 20)
      const unsigned = buildBountyEvent({ ...form, tags })
      const result = await signAndPublish(unsigned, (status) => {
        if (status === 'mining') toast.loading('Processing proof of work…', { id: 'bounty' })
        if (status === 'signing') toast.loading('Signing…', { id: 'bounty' })
        if (status === 'publishing') toast.loading('Publishing…', { id: 'bounty' })
      })
      if (!result.success) throw new Error(result.error || 'Failed to publish')
      toast.success(isEdit ? 'Bounty updated' : 'Bounty posted', { id: 'bounty' })
      const addr = nip19.naddrEncode({ identifier: form.dTag, pubkey: pubkey!, kind: KINDS.BOUNTY })
      navigate(`/mod-bounty/${addr}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'bounty' })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-6">
      <div className="mb-6 flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-purple-400" />
        <h1 className="text-2xl font-bold text-white">{isEdit ? 'Edit mod bounty' : 'Post a mod bounty'}</h1>
      </div>
      <p className="mb-6 text-sm text-neutral-400">Request a mod that doesn’t exist yet. Describe what you want, for which game, and (optionally) a reward.</p>

      <div className="space-y-5">
        <Field label="Title" required>
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={LIMITS.title} placeholder="e.g. First-person camera for vehicles" className={inputClass} />
          <CharCounter value={form.title} max={LIMITS.title} />
        </Field>

        <Field label="Game" required hint="The game this mod is wanted for.">
          <GameAutocomplete value={form.game} onChange={(v) => set('game', v)} maxLength={LIMITS.game} className={inputClass} />
        </Field>

        <Field label="Description" required hint="Markdown supported. What the mod should do and why.">
          <Textarea value={form.content} onChange={(e) => set('content', e.target.value)} maxLength={LIMITS.content} rows={8} placeholder="Describe the mod you want…" className={inputClass} />
          <CharCounter value={form.content} max={LIMITS.content} />
        </Field>

        <Field label="Reward" hint="Optional. What you’re offering, and how you’ll deliver it.">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Input value={form.reward.what} onChange={(e) => set('reward', { ...form.reward, what: e.target.value })} maxLength={LIMITS.rewardWhat} placeholder="What — e.g. 50,000 sats" className={inputClass} />
              <CharCounter value={form.reward.what} max={LIMITS.rewardWhat} />
            </div>
            <div>
              <Input value={form.reward.how} onChange={(e) => set('reward', { ...form.reward, how: e.target.value })} maxLength={LIMITS.rewardHow} placeholder="How — e.g. zap on release" className={inputClass} />
              <CharCounter value={form.reward.how} max={LIMITS.rewardHow} />
            </div>
          </div>
        </Field>

        <Field label="Cover image" hint="Optional image URL for the card.">
          <Input value={form.featuredImageUrl} onChange={(e) => set('featuredImageUrl', e.target.value)} maxLength={LIMITS.image} placeholder="https://…" className={inputClass} />
        </Field>

        <Field label="Summary" hint="Optional short line for listings.">
          <Input value={form.summary} onChange={(e) => set('summary', e.target.value)} maxLength={LIMITS.summary} placeholder="One-line summary" className={inputClass} />
          <CharCounter value={form.summary} max={LIMITS.summary} />
        </Field>

        <Field label="Tags" hint="Optional, comma-separated.">
          <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="camera, vehicles" className={inputClass} />
        </Field>

        <Button onClick={publish} disabled={publishing} className="w-full bg-[#fc4462] text-white hover:bg-[#e23a56]">
          {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
          {isEdit ? 'Update bounty' : 'Post bounty'}
        </Button>
      </div>
    </div>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-200">
        {label}{required && <span className="text-[#fc4462]">*</span>}
      </label>
      {hint && <p className={cn('text-xs text-neutral-500')}>{hint}</p>}
      {children}
    </div>
  )
}
