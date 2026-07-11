import { useState, useEffect, useMemo } from 'react'
import { ScrollText, Loader2, ChevronDown } from 'lucide-react'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { extractTos, TOS_DTAG, type TosItem } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { Markdown } from '@/components/shared/Markdown'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function TosPage() {
  const [items, setItems] = useState<TosItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const event = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [TOS_DTAG] })
        if (!cancelled) setItems(event ? extractTos(event) : [])
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    const words = q.split(/\s+/)
    return items.filter(i => words.every(w => `${i.title} ${i.body}`.toLowerCase().includes(w)))
  }, [search, items])

  return (
    <div className="py-8">
      <div className="mb-6 flex items-center gap-3">
        <ScrollText className="h-7 w-7 text-purple-400" />
        <h1 className="text-3xl font-bold tracking-tight">Terms of Use</h1>
      </div>

      {!loading && items.length > 0 && (
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the terms…"
          className="mb-5 bg-[#1c1c1c] border-[#262626]"
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">{items.length === 0 ? 'No terms published yet.' : 'No matches.'}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            const idx = items.indexOf(item)
            const isOpen = open === idx
            return (
              <div key={idx} className="overflow-hidden rounded-lg border border-[#262626] bg-[#1c1c1c]">
                <button
                  onClick={() => setOpen(isOpen ? null : idx)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-neutral-200 hover:bg-[#212121]"
                >
                  {item.title}
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-neutral-500 transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="border-t border-[#262626] px-4 py-3 text-sm text-neutral-300">
                    <Markdown content={item.body} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
