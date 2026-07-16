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
import { extractJam, jamStatus, monthBuckets, monthLabel, type JamDetails, type JamStatus } from '@/lib/nostr/jam'
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

function monthToTs(m: string, endOfMonth = false): number {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1, 1))
  if (endOfMonth) { d.setUTCMonth(d.getUTCMonth() + 1); return Math.floor(d.getTime() / 1000) - 1 }
  return Math.floor(d.getTime() / 1000)
}

// The browse window is capped so the relay-side `#y` filter stays small: one `y`
// value per month, so 12 months = at most 12 tag values in the query.
const MAX_SPAN = 12

const monthKeyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

function addMonths(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number)
  return monthKeyOf(new Date(Date.UTC(y, mo - 1 + n, 1)))
}

/**
 * The window actually queried: the picked range (clamped to MAX_SPAN), a single
 * picked bound extrapolated, or — when nothing is picked — a rolling default of
 * the last 3 + next 9 months, which covers everything active/upcoming/voting
 * plus recently ended. Widening the pickers walks the window.
 */
function effectiveRange(from: string, to: string, nowMonth: string): { from: string; to: string } {
  if (from && to) {
    const cap = addMonths(from, MAX_SPAN - 1)
    return { from, to: to > cap ? cap : to }
  }
  if (from) return { from, to: addMonths(from, MAX_SPAN - 1) }
  if (to) return { from: addMonths(to, -(MAX_SPAN - 1)), to }
  return { from: addMonths(nowMonth, -2), to: addMonths(nowMonth, MAX_SPAN - 3) }
}

export function ModJamsPage() {
  const [jams, setJams] = useState<JamDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')
  const now = Math.floor(Date.now() / 1000)
  // Stable across renders so the queried window (and the fetch) doesn't churn.
  const [nowMonth] = useState(() => monthKeyOf(new Date()))

  const eff = useMemo(() => effectiveRange(fromMonth, toMonth, nowMonth), [fromMonth, toMonth, nowMonth])
  // One `y` bucket per month in the window — this is what narrows the query at the
  // relay instead of pulling every jam ever published.
  const buckets = useMemo(() => monthBuckets(monthToTs(eff.from), monthToTs(eff.to, true)), [eff])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchEvents(relays, { kinds: [KINDS.JAM], '#y': buckets, limit: 500 }, 8000)
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
  }, [buckets])

  // `y` is an untrusted, coarse index that can only ever over-include, so the real
  // window is always re-derived from start/end/voting_end here.
  const rangeStart = monthToTs(eff.from)
  const rangeEnd = monthToTs(eff.to, true)

  const filtered = useMemo(() => {
    let list = [...jams]
    if (status !== 'all') list = list.filter((j) => jamStatus(j, now) === status)
    list = list.filter((j) => {
      const spanEnd = j.votingEnd ?? j.end
      return spanEnd >= rangeStart && j.start <= rangeEnd
    })
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
          <MonthPicker
            value={fromMonth}
            onChange={setFromMonth}
            placeholder="Any month"
            minMonth={toMonth ? addMonths(toMonth, -(MAX_SPAN - 1)) : undefined}
            maxMonth={toMonth || undefined}
          />
          <span>to</span>
          <MonthPicker
            value={toMonth}
            onChange={setToMonth}
            placeholder="Any month"
            minMonth={fromMonth || undefined}
            maxMonth={fromMonth ? addMonths(fromMonth, MAX_SPAN - 1) : undefined}
          />
          {(fromMonth || toMonth) && (
            <button onClick={() => { setFromMonth(''); setToMonth('') }} className="text-neutral-500 hover:text-neutral-300">clear</button>
          )}
        </div>
      </div>

      <p className="-mt-2 text-[11px] text-neutral-500">
        Showing {monthLabel(eff.from)} – {monthLabel(eff.to)} · up to {MAX_SPAN} months at a time. Move the range to browse other periods.
      </p>

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
