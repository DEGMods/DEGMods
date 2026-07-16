import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Loader2 } from 'lucide-react'
import type { Event as NostrEvent } from 'nostr-tools'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchBar } from '@/components/search/SearchBar'
import { JamCard } from '@/components/jam/JamCard'
import { MonthPicker } from '@/components/jam/MonthPicker'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { extractJam, jamStatus, type JamDetails, type JamStatus } from '@/lib/nostr/jam'
import { KINDS } from '@/lib/constants'
import { cn } from '@/lib/utils'

type StatusFilter = 'all' | JamStatus

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'voting', label: 'Voting' },
  { key: 'ended', label: 'Ended' },
]

// Sort: active → upcoming → voting → ended, each by its nearest relevant date.
const STATUS_RANK: Record<JamStatus, number> = { active: 0, upcoming: 1, voting: 2, ended: 3 }
function compareJams(a: JamDetails, b: JamDetails, now: number): number {
  const sa = jamStatus(a, now), sb = jamStatus(b, now)
  if (STATUS_RANK[sa] !== STATUS_RANK[sb]) return STATUS_RANK[sa] - STATUS_RANK[sb]
  switch (sa) {
    case 'active': return a.end - b.end
    case 'upcoming': return a.start - b.start
    case 'voting': return (a.votingEnd ?? a.end) - (b.votingEnd ?? b.end)
    default: return b.end - a.end // ended: most recent first
  }
}

function monthToTs(m: string, endOfMonth = false): number | null {
  const [y, mo] = m.split('-').map(Number)
  if (!y || !mo) return null
  const d = new Date(Date.UTC(y, mo - 1, 1))
  if (endOfMonth) { d.setUTCMonth(d.getUTCMonth() + 1); return Math.floor(d.getTime() / 1000) - 1 }
  return Math.floor(d.getTime() / 1000)
}

export function ModJamsPage() {
  const [jams, setJams] = useState<JamDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')
  const now = Math.floor(Date.now() / 1000)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchEvents(relays, { kinds: [KINDS.JAM] }, 8000)
      .then((events) => {
        if (cancelled) return
        // Keep the newest event per coordinate (relays may return stale revisions).
        const byCoord = new Map<string, NostrEvent>()
        for (const ev of events) {
          const d = ev.tags.find((t) => t[0] === 'd')?.[1]
          if (!d) continue
          const key = `${ev.pubkey}:${d}`
          const prev = byCoord.get(key)
          if (!prev || ev.created_at > prev.created_at) byCoord.set(key, ev)
        }
        setJams([...byCoord.values()].map(extractJam).filter((j): j is JamDetails => !!j && !!j.title))
      })
      .catch(() => { if (!cancelled) setJams([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const rangeStart = fromMonth ? monthToTs(fromMonth) : null
  const rangeEnd = toMonth ? monthToTs(toMonth, true) : null

  const filtered = useMemo(() => {
    let list = [...jams]
    if (status !== 'all') list = list.filter((j) => jamStatus(j, now) === status)
    if (rangeStart != null || rangeEnd != null) {
      list = list.filter((j) => {
        const spanEnd = j.votingEnd ?? j.end
        if (rangeStart != null && spanEnd < rangeStart) return false
        if (rangeEnd != null && j.start > rangeEnd) return false
        return true
      })
    }
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((j) =>
      j.title.toLowerCase().includes(q) ||
      j.games.some((g) => g.toLowerCase().includes(q)) ||
      j.tags.some((t) => t.toLowerCase().includes(q)),
    )
    return list.sort((a, b) => compareJams(a, b, now))
  }, [jams, status, search, rangeStart, rangeEnd, now])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Mod Jams</h1>
        <Link to="/submit-mod-jam">
          <Button size="sm" className="gap-1.5 bg-[#fc4462] text-xs text-white hover:bg-[#e23a56]">
            <Plus size={14} /> Submit a Mod Jam
          </Button>
        </Link>
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Quick local search by title, game, or tags…" />

      {/* Status tabs + month range */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                status === t.key ? 'bg-[#fc4462] text-white' : 'bg-[#212121] text-neutral-400 hover:text-neutral-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span>From</span>
          <MonthPicker value={fromMonth} onChange={setFromMonth} placeholder="Any month" />
          <span>to</span>
          <MonthPicker value={toMonth} onChange={setToMonth} placeholder="Any month" />
          {(fromMonth || toMonth) && (
            <button onClick={() => { setFromMonth(''); setToMonth('') }} className="text-neutral-500 hover:text-neutral-300">clear</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {filtered.map((jam) => <JamCard key={jam.coordinate} jam={jam} />)}
        </div>
      ) : (
        <p className="py-16 text-center text-neutral-500">
          {jams.length === 0 ? 'No mod jams yet. Be the first to run one!' : 'No mod jams match your filters.'}
        </p>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-1 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading jams…
        </div>
      )}
    </div>
  )
}
