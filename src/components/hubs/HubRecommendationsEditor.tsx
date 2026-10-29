import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Plus, Save, Loader2, X, GripVertical } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAuthStore } from '@/stores/authStore'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { signAndPublish } from '@/lib/nostr/publish'
import { KINDS } from '@/lib/constants'
import {
  HUB_KIND, HUB_RECOMMENDATIONS_DTAG, parseHubEvent, parseHubRecommendations,
  parseHubNaddr, buildHubRecommendationsEvent,
} from '@/lib/nostr/hubs'
import { useDragReorder } from '@/hooks/useDragReorder'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface HubItem {
  coord: string
  pubkey: string
  dTag: string
  relayHint?: string
  name?: string
  resolving?: boolean
}

/**
 * Add / remove / drag-reorder the LOGGED-IN user's recommended-hubs list (NIP-78,
 * d = 36942-hub-recommendations) and publish it under their key. Shared by the
 * admin Featured tab (the admin edits the site list) and the per-author "manage"
 * modal on a profile (a creator edits their own). `shownCount` marks which rows
 * actually render in the surface it feeds (5 on the landing, 1 on a profile).
 */
export function HubRecommendationsEditor({
  shownCount = 5,
  onPublished,
}: {
  shownCount?: number
  onPublished?: () => void
}) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const [items, setItems] = useState<HubItem[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [dirty, setDirty] = useState(false)

  const resolveName = useCallback(async (rec: { pubkey: string; dTag: string; relayHint?: string }): Promise<string | undefined> => {
    const read = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    const urls = [...new Set([...(rec.relayHint ? [rec.relayHint] : []), ...read])]
    const event = await fetchEvent(urls, { kinds: [HUB_KIND], authors: [rec.pubkey], '#d': [rec.dTag] })
    return event ? parseHubEvent(event).name : undefined
  }, [])

  const load = useCallback(async () => {
    if (!myPubkey) { setLoading(false); return }
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [myPubkey], '#d': [HUB_RECOMMENDATIONS_DTAG] })
      const recs = parseHubRecommendations(event)
      setItems(recs.map((r) => ({ ...r, resolving: true })))
      setDirty(false)
      recs.forEach(async (r) => {
        const name = await resolveName(r).catch(() => undefined)
        setItems((prev) => prev.map((it) => (it.coord === r.coord ? { ...it, name, resolving: false } : it)))
      })
    } catch {
      toast.error('Failed to load your hubs')
    } finally {
      setLoading(false)
    }
  }, [myPubkey, resolveName])

  useEffect(() => { load() }, [load])

  const addItem = async () => {
    const result = parseHubNaddr(input)
    if ('error' in result) { toast.error(result.error); return }
    if (items.some((it) => it.coord === result.coord)) { toast.error('Already in the list'); return }
    const newItem: HubItem = { ...result, resolving: true }
    setItems((prev) => [...prev, newItem])
    setInput('')
    setDirty(true)
    const name = await resolveName(result).catch(() => undefined)
    setItems((prev) => prev.map((it) => (it.coord === newItem.coord ? { ...it, name, resolving: false } : it)))
  }

  const removeItem = (coord: string) => { setItems((prev) => prev.filter((it) => it.coord !== coord)); setDirty(true) }
  const { dragIndex, itemProps } = useDragReorder(setItems, () => setDirty(true))

  const publish = async () => {
    setPublishing(true)
    try {
      const unsigned = buildHubRecommendationsEvent(items.map((it) => ({ coord: it.coord, relayHint: it.relayHint })))
      const result = await signAndPublish(unsigned, (status) => {
        if (status === 'mining') toast.loading('Processing proof of work…', { id: HUB_RECOMMENDATIONS_DTAG })
        if (status === 'signing') toast.loading('Signing…', { id: HUB_RECOMMENDATIONS_DTAG })
        if (status === 'publishing') toast.loading('Publishing…', { id: HUB_RECOMMENDATIONS_DTAG })
      })
      if (result.success) {
        toast.success(`Hubs published (${items.length})`, { id: HUB_RECOMMENDATIONS_DTAG })
        setDirty(false)
        onPublished?.()
      } else {
        toast.error(result.error || 'Publish failed', { id: HUB_RECOMMENDATIONS_DTAG })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: HUB_RECOMMENDATIONS_DTAG })
    } finally {
      setPublishing(false)
    }
  }

  if (!myPubkey) return <p className="text-xs text-neutral-500">Sign in to manage your hubs.</p>

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
          placeholder="naddr1… (DEN Chat hub)"
          className="bg-[#212121] border-[#262626] text-white text-xs font-mono"
        />
        <Button size="sm" onClick={addItem} disabled={!input.trim()} className="bg-purple-600 hover:bg-purple-700 shrink-0">
          <Plus size={14} className="mr-1" /> Add
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-neutral-600 py-2">No hubs added yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li
              key={it.coord}
              {...itemProps(i)}
              className={cn(
                'flex items-center gap-2 rounded-md border border-[#262626] bg-[#212121] px-2.5 py-1.5',
                dragIndex === i && 'opacity-40',
              )}
            >
              <GripVertical size={14} className="text-neutral-600 cursor-grab shrink-0" />
              <span className="text-[10px] text-neutral-600 w-4 shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-neutral-200 truncate">
                  {it.resolving ? 'Resolving…' : (it.name || <span className="text-neutral-500 italic">Unknown / not found</span>)}
                  {i === 0 && <span className="ml-1.5 text-[10px] text-purple-400">priority</span>}
                  {i >= shownCount && <span className="ml-1.5 text-[10px] text-neutral-600">(not shown)</span>}
                </p>
                <p className="text-[10px] text-neutral-600 font-mono truncate">{it.coord}</p>
              </div>
              <button onClick={() => removeItem(it.coord)} className="text-neutral-500 hover:text-red-400 shrink-0" aria-label="Remove">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={publish} disabled={publishing || !dirty} className="bg-purple-600 hover:bg-purple-700 text-xs">
          {publishing ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Save size={12} className="mr-1.5" />}
          Publish
        </Button>
        {dirty && <span className="text-[11px] text-yellow-500/80">Unpublished changes</span>}
      </div>
    </div>
  )
}
