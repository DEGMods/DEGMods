import { useState, useEffect, useMemo } from 'react'
import { HelpCircle, Loader2, ChevronDown } from 'lucide-react'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { extractFaq, FAQ_DTAG, type FaqItem } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { Markdown } from '@/components/shared/Markdown'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function FaqPage() {
  const [items, setItems] = useState<FaqItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const event = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [FAQ_DTAG] })
        if (!cancelled) setItems(event ? extractFaq(event) : [])
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
    return items.filter(i => words.every(w => `${i.question} ${i.answer}`.toLowerCase().includes(w)))
  }, [search, items])

  return (
    <div className="py-8">
      <div className="mb-6 flex items-center gap-3">
        <HelpCircle className="h-7 w-7 text-purple-400" />
        <h1 className="text-3xl font-bold tracking-tight">FAQ</h1>
      </div>

      {!loading && items.length > 0 && (
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the FAQ…"
          className="mb-5 bg-[#1c1c1c] border-[#262626]"
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">{items.length === 0 ? 'No FAQ entries yet.' : 'No matches.'}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((item, i) => {
            const idx = items.indexOf(item)
            const isOpen = open === idx
            return (
              <div key={idx} className="overflow-hidden rounded-lg border border-[#262626] bg-[#1c1c1c]">
                <button
                  onClick={() => setOpen(isOpen ? null : idx)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-neutral-200 hover:bg-[#212121]"
                >
                  {item.question}
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-neutral-500 transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="border-t border-[#262626] px-4 py-3 text-sm text-neutral-300">
                    <Markdown content={item.answer} />
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
