import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { toast } from 'sonner'
import { Loader2, Plus, X, Pencil, Eye } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MarkdownToolbar } from '@/components/shared/MarkdownToolbar'
import { Markdown } from '@/components/shared/Markdown'
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
    tags: [], contentWarning: false, contentWarningReason: '', reward: { what: '', how: '' },
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
  const bodyRef = useRef<HTMLTextAreaElement>(null)
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
      if (!coord) { toast.error('Invalid request address'); navigate('/mod-requests'); return }
      const [, authorPk, ...idParts] = coord.split(':')
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const ev = await fetchLatestEvent(relays, { kinds: [KINDS.BOUNTY], authors: [authorPk], '#d': [idParts.join(':')] })
      if (cancelled) return
      const b = ev ? extractBounty(ev) : null
      if (!b || !ev) { toast.error('Mod request not found'); navigate('/mod-requests'); return }
      if (b.pubkey !== pubkey) { toast.error('You can only edit your own requests'); navigate(`/mod-request/${naddr}`); return }
      setForm({
        dTag: b.dTag, isEdit: true, previousCreatedAt: ev.created_at, publishedAt: b.publishedAt,
        title: b.title, featuredImageUrl: b.image, summary: b.summary, content: b.content, game: b.game,
        tags: b.tags, contentWarning: !!b.contentWarning, contentWarningReason: b.contentWarning || '',
        reward: b.reward ?? { what: '', how: '' },
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
      navigate(`/mod-request/${addr}`)
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
        <Section title="Basics" incomplete={!form.title.trim() || !form.game.trim()}>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={LIMITS.title} placeholder="e.g. First-person camera for vehicles" className={inputClass} />
            <CharCounter value={form.title} max={LIMITS.title} />
          </div>
          <div className="space-y-2">
            <Label hint="(the game this mod is wanted for)">Game</Label>
            <GameAutocomplete value={form.game} onChange={(v) => set('game', v)} maxLength={LIMITS.game} className={inputClass} />
          </div>
          <div className="space-y-2">
            <Label hint="(optional, shown in listings)">Summary</Label>
            <Input value={form.summary} onChange={(e) => set('summary', e.target.value)} maxLength={LIMITS.summary} placeholder="One-line summary" className={inputClass} />
            <CharCounter value={form.summary} max={LIMITS.summary} />
          </div>
        </Section>

        <Section title="Details" incomplete={!form.content.trim()}>
          <div className="space-y-2">
            <Label hint="(markdown)">Description</Label>
            <Tabs defaultValue="edit" className="w-full">
              <TabsList className="border border-[#262626] bg-[#212121]">
                <TabsTrigger value="edit" className="gap-1.5 text-xs data-[state=active]:bg-[#2a2a2a]"><Pencil size={13} /> Edit</TabsTrigger>
                <TabsTrigger value="preview" className="gap-1.5 text-xs data-[state=active]:bg-[#2a2a2a]"><Eye size={13} /> Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="mt-3 space-y-2">
                <MarkdownToolbar textareaRef={bodyRef} value={form.content} onChange={(val) => set('content', val)} />
                <Textarea ref={bodyRef} value={form.content} onChange={(e) => set('content', e.target.value)} rows={8} maxLength={LIMITS.content} placeholder="What the mod should do and why..." className={cn(inputClass, 'min-h-[220px] resize-y')} />
                <CharCounter value={form.content} max={LIMITS.content} />
              </TabsContent>
              <TabsContent value="preview" className="mt-3">
                <div className="min-h-[220px] rounded-lg border border-[#262626] bg-[#212121] p-4">
                  {form.content.trim() ? <Markdown content={form.content} /> : <span className="text-sm italic text-neutral-600">Nothing to preview</span>}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <label className="flex cursor-pointer items-center gap-3">
            <Switch checked={form.contentWarning} onCheckedChange={(v) => set('contentWarning', v)} />
            <span className="text-sm text-neutral-300">Mark this request as NSFW</span>
          </label>

          <div className="space-y-2">
            <Label hint="(optional)">Featured image</Label>
            <Input value={form.featuredImageUrl} onChange={(e) => set('featuredImageUrl', e.target.value)} maxLength={LIMITS.image} placeholder="Image URL (https://...)" className={inputClass} />
            <CharCounter value={form.featuredImageUrl} max={LIMITS.image} />
            <div className="flex items-center gap-3 pt-1">
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
        </Section>

        <Section title="Reward">
          <p className="text-xs text-neutral-500">Optional and descriptive only - nothing is held or paid through the app.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>What</Label>
              <Input value={form.reward.what} onChange={(e) => set('reward', { ...form.reward, what: e.target.value })} maxLength={LIMITS.rewardWhat} placeholder="e.g. $100" className={inputClass} />
              <CharCounter value={form.reward.what} max={LIMITS.rewardWhat} />
            </div>
            <div className="space-y-2">
              <Label>How</Label>
              <Input value={form.reward.how} onChange={(e) => set('reward', { ...form.reward, how: e.target.value })} maxLength={LIMITS.rewardHow} placeholder="How will you deliver this?" className={inputClass} />
              <CharCounter value={form.reward.how} max={LIMITS.rewardHow} />
            </div>
          </div>
        </Section>

        <Section title="Tags">
          <div className="space-y-2">
            <Label hint="(optional)">Tags</Label>
            <TagRows tags={form.tags} onChange={(v) => set('tags', v)} maxLength={LIMITS.tag} max={MAX_TAGS} />
          </div>
        </Section>

        <Button onClick={publish} disabled={publishing} className="w-full bg-orange-600 text-white hover:bg-orange-700">
          {publishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEdit ? 'Update request' : 'Post request'}
        </Button>
      </div>
    </div>
  )
}

const Section = ({ title, incomplete, children }: { title: string; incomplete?: boolean; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-xl border border-[#262626] bg-[#1c1c1c] p-4">
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {incomplete && <RequiredDot label="Something required in this section is still empty" />}
    </div>
    {children}
  </section>
)

const Label = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <label className="block text-xs font-medium text-neutral-400">{children}{hint && <span className="ml-1 text-neutral-600">{hint}</span>}</label>
)

/** Per-row tag editor: each tag is its own field with an × to remove and an Add button below. */
function TagRows({ tags, onChange, maxLength, max }: { tags: string[]; onChange: (v: string[]) => void; maxLength: number; max: number }) {
  const full = tags.length >= max
  const update = (i: number, v: string) => { const next = [...tags]; next[i] = v; onChange(next) }
  const remove = (i: number) => onChange(tags.filter((_, idx) => idx !== i))
  const add = () => { if (!full) onChange([...tags, '']) }
  return (
    <div className="space-y-2">
      {tags.map((tag, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center gap-2">
            <Input
              value={tag}
              onChange={(e) => update(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (i === tags.length - 1 && tag.trim() && !full) add() } }}
              placeholder={`Tag #${i + 1}`}
              maxLength={maxLength}
              className={cn(inputClass, 'flex-1')}
            />
            <button type="button" onClick={() => remove(i)} className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-[#2a2a2a] hover:text-neutral-300"><X size={14} /></button>
          </div>
          <CharCounter value={tag} max={maxLength} />
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={full} className="border-[#262626] bg-transparent text-xs text-neutral-400 hover:bg-[#2a2a2a]">
          <Plus size={14} className="mr-1" /> Add Tag
        </Button>
        <span className={cn('text-[10px] tabular-nums', full ? 'text-amber-400' : 'text-neutral-600')}>{tags.length}/{max}</span>
      </div>
    </div>
  )
}
