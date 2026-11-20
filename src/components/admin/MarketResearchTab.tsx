import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Save, X, Search, ExternalLink, GripVertical } from 'lucide-react'
import type { Filter } from 'nostr-tools'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { signAndPublish } from '@/lib/nostr/publish'
import { useSettingsStore } from '@/stores/settingsStore'
import { useGamesDbStore } from '@/stores/gamesDbStore'
import {
  buildMarketResearchEvent, extractMarketResearch, MARKET_RESEARCH_TAG,
  MR_TITLE_MAX, MR_DESC_MAX, MR_NOTE_MAX, MR_MAX_ENTRIES,
  type MarketResearchEntry,
} from '@/lib/nostr/events'
import { useDragReorder } from '@/hooks/useDragReorder'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EditEntry extends MarketResearchEntry { id: string }

const inputClass = 'bg-[#212121] border-[#262626] text-white text-sm'
const serialize = (list: EditEntry[]) =>
  JSON.stringify(list.map((e) => ({ title: e.title, description: e.description, note: e.note ?? '' })))

/**
 * Admin editor for the per-game "Most wanted mods" list rendered at
 * /game/<game>/mr. Pick a game (search over the games DB), edit the list, publish
 * a NIP-78 event tagged `q = <game>`. Editing a game that already has a list
 * reuses its `d` tag so the publish replaces it.
 */
export function MarketResearchTab() {
  const searchGames = useGamesDbStore((s) => s.searchGames)
  const [game, setGame] = useState('')
  const [query, setQuery] = useState('')
  const [dTag, setDTag] = useState('')
  const [entries, setEntries] = useState<EditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [baseline, setBaseline] = useState('[]')

  const results = query.trim() ? searchGames(query) : []
  const dirty = serialize(entries) !== baseline
  const atCap = entries.length >= MR_MAX_ENTRIES

  const selectGame = useCallback(async (name: string) => {
    setGame(name)
    setQuery('')
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, {
        kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], [`#${MARKET_RESEARCH_TAG}`]: [name],
      } as Filter)
      const withIds = (event ? extractMarketResearch(event) : []).map((e): EditEntry => ({ ...e, id: crypto.randomUUID() }))
      setEntries(withIds)
      setBaseline(serialize(withIds))
      // Reuse the existing event's d tag so a re-publish replaces it; else mint one.
      setDTag(event?.tags.find((t) => t[0] === 'd')?.[1] || crypto.randomUUID())
    } catch {
      toast.error('Failed to load this game’s list')
      setEntries([]); setBaseline('[]'); setDTag(crypto.randomUUID())
    } finally {
      setLoading(false)
    }
  }, [])

  const update = (id: string, patch: Partial<EditEntry>) =>
    setEntries((p) => p.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const remove = (id: string) => setEntries((p) => p.filter((e) => e.id !== id))
  // Reorder marks dirty automatically (serialize changes); the handle is the drag
  // source and the card the drop target, so the text inputs stay editable.
  const { dragIndex, itemProps } = useDragReorder(setEntries, () => {})
  const add = () => setEntries((p) => (p.length >= MR_MAX_ENTRIES ? p : [...p, { id: crypto.randomUUID(), title: '', description: '', note: '' }]))

  const publish = async () => {
    if (!game) return
    setPublishing(true)
    try {
      const clean: MarketResearchEntry[] = entries.map((e) => ({ title: e.title, description: e.description, note: e.note }))
      const result = await signAndPublish(buildMarketResearchEvent(game, clean, dTag), (s) => {
        if (s === 'mining') toast.loading('Processing proof of work…', { id: 'mr' })
        if (s === 'publishing') toast.loading('Publishing…', { id: 'mr' })
      })
      if (result.success) {
        toast.success(`Published most-wanted mods for ${game}`, { id: 'mr' })
        setBaseline(serialize(entries))
      } else {
        toast.error(result.error || 'Publish failed', { id: 'mr' })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'mr' })
    } finally {
      setPublishing(false)
    }
  }

  // ── Game picker (no game chosen yet) ──
  if (!game) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">
          Pick a game to edit its <span className="font-mono text-neutral-300">/game/&lt;game&gt;/mr</span> list of most-wanted mods.
        </p>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games…"
            className={cn(inputClass, 'pl-9')}
            autoFocus
          />
        </div>
        {results.length > 0 && (
          <ul className="max-h-80 divide-y divide-[#262626] overflow-y-auto rounded-lg border border-[#262626] bg-[#1c1c1c]">
            {results.map((g) => (
              <li key={g.name}>
                <button
                  onClick={() => selectGame(g.name)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[#212121]"
                >
                  {(g.boxartImage || g.wideImage) && (
                    <img src={g.boxartImage || g.wideImage} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                  )}
                  <span className="truncate text-sm text-neutral-200">{g.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && results.length === 0 && (
          <p className="text-xs text-neutral-600">No games match “{query}”. The games DB may need a sync (Games Database tab).</p>
        )}
      </div>
    )
  }

  // ── Editor for the chosen game ──
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm text-neutral-300">
          Editing: <span className="font-medium text-white">{game}</span>
          <button
            onClick={() => { setGame(''); setEntries([]); setBaseline('[]'); setDTag('') }}
            className="ml-2 text-xs text-purple-400 hover:text-purple-300"
          >
            change game
          </button>
        </div>
        <a
          href={`/game/${encodeURIComponent(game)}/mr`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white"
        >
          Preview <ExternalLink size={13} />
        </a>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-neutral-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">{entries.length}/{MR_MAX_ENTRIES} mods</p>
            <Button onClick={add} disabled={atCap} variant="outline" size="sm" className="border-[#262626] shrink-0">
              <Plus size={14} className="mr-1.5" /> Add mod
            </Button>
          </div>

          {entries.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">No mods listed yet.</p>}

          {entries.map((it, idx) => {
            const dp = itemProps(idx)
            return (
            <div
              key={it.id}
              onDragOver={dp.onDragOver}
              onDrop={dp.onDrop}
              className={cn('space-y-2 rounded-lg border border-[#262626] bg-[#1c1c1c] p-4', dragIndex === idx && 'opacity-40')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    draggable={dp.draggable}
                    onDragStart={dp.onDragStart}
                    onDragEnd={dp.onDragEnd}
                    className="cursor-grab text-neutral-600 hover:text-neutral-400"
                    aria-label="Drag to reorder"
                  >
                    <GripVertical size={14} />
                  </span>
                  <span className="text-xs font-semibold text-neutral-300">Mod #{idx + 1}</span>
                </div>
                <button onClick={() => remove(it.id)} className="text-neutral-500 hover:text-red-400" aria-label="Remove"><X size={16} /></button>
              </div>
              <Input
                value={it.title}
                onChange={(e) => update(it.id, { title: e.target.value })}
                placeholder="Mod title"
                maxLength={MR_TITLE_MAX}
                className={inputClass}
              />
              <Counter value={it.title} max={MR_TITLE_MAX} />
              <Textarea
                value={it.description}
                onChange={(e) => update(it.id, { description: e.target.value })}
                placeholder="What the mod is / what it should do"
                maxLength={MR_DESC_MAX}
                rows={3}
                className={inputClass}
              />
              <Counter value={it.description} max={MR_DESC_MAX} />
              <Textarea
                value={it.note ?? ''}
                onChange={(e) => update(it.id, { note: e.target.value })}
                placeholder="Why it's wanted — the reason or issue (optional)"
                maxLength={MR_NOTE_MAX}
                rows={2}
                className={inputClass}
              />
              <Counter value={it.note ?? ''} max={MR_NOTE_MAX} />
            </div>
            )
          })}

          <Button onClick={publish} disabled={!dirty || publishing} className="w-full">
            {publishing ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
            Publish list for {game}
          </Button>
        </>
      )}
    </div>
  )
}

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <p className={cn('text-right text-[10px]', value.length >= max ? 'text-amber-500' : 'text-neutral-600')}>
      {value.length}/{max}
    </p>
  )
}
