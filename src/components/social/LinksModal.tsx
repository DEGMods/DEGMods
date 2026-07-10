import { useState, useEffect } from 'react'
import { ExternalLink, Loader2, TreePine, Plus, Pencil, Trash2, X, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { Event as NostrEvent } from 'nostr-tools'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { signAndPublish } from '@/lib/nostr/publish'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAuthStore } from '@/stores/authStore'

const LINK_SET_KIND = 30003 // NIP-51 link sets (linktree-style)

interface LinkItem { url: string; label: string }
interface LinkSet {
  dTag: string
  title: string
  description: string
  image: string
  links: LinkItem[]
  order: number
  createdAt: number
}

function parseLinkSets(events: NostrEvent[]): LinkSet[] {
  const byD = new Map<string, NostrEvent>()
  for (const ev of events) {
    const d = ev.tags.find((t) => t[0] === 'd')?.[1] || ''
    if (!d.startsWith('links-')) continue
    const existing = byD.get(d)
    if (!existing || ev.created_at > existing.created_at) byD.set(d, ev)
  }
  return Array.from(byD.values())
    .map((ev) => {
      const dTag = ev.tags.find((t) => t[0] === 'd')?.[1] || ''
      const title = ev.tags.find((t) => t[0] === 'title')?.[1] || ''
      const description = ev.tags.find((t) => t[0] === 'description')?.[1] || ''
      const image = ev.tags.find((t) => t[0] === 'image')?.[1] || ''
      const orderStr = ev.tags.find((t) => t[0] === 'order')?.[1]
      const order = orderStr != null ? parseInt(orderStr, 10) : Number.POSITIVE_INFINITY
      const links: LinkItem[] = ev.tags
        .filter((t) => t[0] === 'r' && t[1])
        .map((t) => ({ url: t[1], label: t[2] || t[1] }))
      return { dTag, title, description, image, links, order, createdAt: ev.created_at }
    })
    .filter((s) => s.links.length > 0)
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : b.createdAt - a.createdAt))
}

function buildLinkSetEvent(set: LinkSet) {
  const tags: string[][] = [['d', set.dTag]]
  if (set.title.trim()) tags.push(['title', set.title.trim()])
  if (set.description.trim()) tags.push(['description', set.description.trim()])
  if (set.image.trim()) tags.push(['image', set.image.trim()])
  tags.push(['order', String(set.order ?? 0)])
  for (const l of set.links) {
    if (l.url.trim()) tags.push(['r', l.url.trim(), l.label.trim()])
  }
  return { kind: LINK_SET_KIND, content: '', tags, created_at: Math.floor(Date.now() / 1000), pubkey: '' }
}

interface LinksModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pubkey: string
  displayName?: string
}

export function LinksModal({ open, onOpenChange, pubkey, displayName }: LinksModalProps) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const isSelf = myPubkey === pubkey

  const [sets, setSets] = useState<LinkSet[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<LinkSet | null>(null)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchEvents(relays, { kinds: [LINK_SET_KIND], authors: [pubkey], limit: 50 }, 6000)
      .then((events) => { setSets(parseLinkSets(events)); setLoading(false) })
      .catch(() => { setSets([]); setLoading(false) })
  }

  useEffect(() => {
    if (!open) return
    setEditing(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pubkey])

  const startNew = () => setEditing({
    dTag: `links-${crypto.randomUUID()}`,
    title: '', description: '', image: '', links: [{ url: '', label: '' }], order: sets.length, createdAt: 0,
  })

  const save = async () => {
    if (!editing) return
    const links = editing.links.filter((l) => l.url.trim())
    if (links.length === 0) { toast.error('Add at least one link'); return }
    setSaving(true)
    try {
      const res = await signAndPublish(buildLinkSetEvent({ ...editing, links }))
      if (!res.success) throw new Error(res.error || 'Failed to publish')
      toast.success('Links saved')
      setEditing(null)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (set: LinkSet) => {
    setSaving(true)
    try {
      // Replaceable: republish with no links so it drops out of the list.
      const res = await signAndPublish({
        kind: LINK_SET_KIND, content: '', tags: [['d', set.dTag]],
        created_at: Math.floor(Date.now() / 1000), pubkey: '',
      })
      if (!res.success) throw new Error(res.error || 'Failed to publish')
      toast.success('Link set deleted')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setSaving(false)
    }
  }

  const updateLink = (i: number, key: keyof LinkItem, value: string) => {
    if (!editing) return
    const links = editing.links.map((l, j) => (j === i ? { ...l, [key]: value } : l))
    setEditing({ ...editing, links })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1c1c1c] border-[#262626] max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-neutral-100">
            <TreePine className="h-5 w-5 text-emerald-400" />
            {editing ? (editing.createdAt ? 'Edit links' : 'New link set') : (displayName ? `${displayName}'s links` : 'Links')}
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            {editing ? 'Publishes a NIP-51 link set (kind 30003).' : 'Link sets this user published on Nostr.'}
          </DialogDescription>
        </DialogHeader>

        {/* Editor */}
        {editing ? (
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <label className="text-xs text-neutral-400">Title</label>
              <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="My links" className="bg-[#212121] border-[#262626] text-white" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-400">Description (optional)</label>
              <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Where to find me" className="bg-[#212121] border-[#262626] text-white" />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-neutral-400">Links</label>
              {editing.links.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={l.label} onChange={(e) => updateLink(i, 'label', e.target.value)} placeholder="Label" className="w-32 shrink-0 bg-[#212121] border-[#262626] text-white text-sm" />
                  <Input value={l.url} onChange={(e) => updateLink(i, 'url', e.target.value)} placeholder="https://…" className="flex-1 bg-[#212121] border-[#262626] text-white text-sm" />
                  <button onClick={() => setEditing({ ...editing, links: editing.links.filter((_, j) => j !== i) })} className="shrink-0 text-neutral-500 hover:text-red-400" aria-label="Remove link">
                    <X size={14} />
                  </button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setEditing({ ...editing, links: [...editing.links, { url: '', label: '' }] })} className="border-[#262626] text-xs text-neutral-300">
                <Plus size={14} className="mr-1" /> Add link
              </Button>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button onClick={save} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)} className="border-[#262626]">Cancel</Button>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading links…
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {isSelf && (
              <Button variant="outline" size="sm" onClick={startNew} className="border-[#262626] text-xs text-neutral-300">
                <Plus size={14} className="mr-1" /> New link set
              </Button>
            )}

            {sets.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-500">No links published.</p>
            ) : (
              sets.map((set) => (
                <div key={set.dTag} className="space-y-2">
                  <div className="flex items-center gap-2">
                    {set.title && <p className="flex-1 text-sm font-semibold text-neutral-100 truncate">{set.title}</p>}
                    {isSelf && (
                      <>
                        <button onClick={() => setEditing(set)} className="text-neutral-500 hover:text-purple-400" aria-label="Edit"><Pencil size={13} /></button>
                        <button onClick={() => remove(set)} disabled={saving} className="text-neutral-500 hover:text-red-400" aria-label="Delete"><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                  {set.description && <p className="text-xs text-neutral-500">{set.description}</p>}
                  <div className="space-y-1.5">
                    {set.links.map((link, i) => (
                      <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2.5 text-sm text-neutral-200 transition-colors hover:border-[#404040] hover:text-white">
                        <span className="truncate">{link.label}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                      </a>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
