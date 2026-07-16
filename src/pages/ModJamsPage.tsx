import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Filter } from 'nostr-tools'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchBar } from '@/components/search/SearchBar'
import { JamCard } from '@/components/jam/JamCard'
import { MonthPicker } from '@/components/jam/MonthPicker'
import { useProgressiveEvents } from '@/hooks/useProgressiveEvents'
import { constructJamListFromEvents, jamStatus, monthBuckets, monthLabel, type JamDetails, type JamStatus } from '@/lib/nostr/jam'
import { KINDS } from '@/lib/constants'
import { cn } from '@/lib/utils'

const JAMS_PER_PAGE = 20
const BATCH = 100

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

// A picked range is capped so the relay-side `#y` filter stays small: one `y`
// value per month, so 12 months = at most 12 tag values in the query.
const MAX_SPAN = 12

const monthKeyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

function addMonths(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number)
  return monthKeyOf(new Date(Date.UTC(y, mo - 1 + n, 1)))
}

/**
 * The month range to query, or null when the user hasn't picked one (the default:
 * just page through the newest jams). A single picked bound is extrapolated to a
 * full span, and a range wider than MAX_SPAN is clamped.
 */
function effectiveRange(from: string, to: string): { from: string; to: string } | null {
  if (!from && !to) return null
  if (from && to) {
    const cap = addMonths(from, MAX_SPAN - 1)
    return { from, to: to > cap ? cap : to }
  }
  if (from) return { from, to: addMonths(from, MAX_SPAN - 1) }
  return { from: addMonths(to, -(MAX_SPAN - 1)), to }
}

export function ModJamsPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')
  const [page, setPage] = useState(1)
  const now = Math.floor(Date.now() / 1000)

  const range = useMemo(() => effectiveRange(fromMonth, toMonth), [fromMonth, toMonth])

  // No range picked → newest jams, paged progressively. With a range → narrow at
  // the relay via the `y` month index (one bucket per month, so ≤ MAX_SPAN values).
  const baseFilter = useMemo<Filter>(() => (
    range
      ? { kinds: [KINDS.JAM], '#y': monthBuckets(monthToTs(range.from), monthToTs(range.to, true)) }
      : { kinds: [KINDS.JAM] }
  ), [range])

  const { events, loading, loadingMore, reachedEnd, loadMore } = useProgressiveEvents(baseFilter, BATCH)
  const jams = useMemo(() => constructJamListFromEvents(events), [events])

  const filtered = useMemo(() => {
    let list = [...jams]
    if (status !== 'all') list = list.filter((j) => jamStatus(j, now) === status)
    // `y` is an untrusted, coarse index that can only ever over-include, so when a
    // range is picked the real window is re-derived from start/end/voting_end.
    if (range) {
      const rs = monthToTs(range.from), re = monthToTs(range.to, true)
      list = list.filter((j) => (j.votingEnd ?? j.end) >= rs && j.start <= re)
    }
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((j) =>
      j.title.toLowerCase().includes(q) ||
      j.games.some((g) => g.toLowerCase().includes(q)) ||
      j.tags.some((t) => t.toLowerCase().includes(q)),
    )
    return list.sort((a, b) => compareJams(a, b, now))
  }, [jams, status, search, range, now])

  const totalPages = Math.max(1, Math.ceil(filtered.length / JAMS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * JAMS_PER_PAGE, currentPage * JAMS_PER_PAGE)

  // Reset to page 1 on filter changes.
  useEffect(() => { setPage(1) }, [search, status, fromMonth, toMonth])

  // Prefetch an older batch as the user nears the last loaded page.
  useEffect(() => {
    if (!loading && !reachedEnd && currentPage >= totalPages - 1) loadMore()
  }, [currentPage, totalPages, reachedEnd, loading, loadMore])

  // Page buttons with ellipses (the list grows as more jams are fetched).
  const pageNumbers = useMemo(() => {
    const nums: (number | 'ellipsis')[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) nums.push(i)
    } else {
      nums.push(1)
      if (currentPage > 3) nums.push('ellipsis')
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) nums.push(i)
      if (currentPage < totalPages - 2) nums.push('ellipsis')
      nums.push(totalPages)
    }
    return nums
  }, [currentPage, totalPages])

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

      {range && (
        <p className="-mt-2 text-[11px] text-neutral-500">
          Filtering {monthLabel(range.from)} – {monthLabel(range.to)} · up to {MAX_SPAN} months at a time.
        </p>
      )}

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
      ) : paginated.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {paginated.map((jam) => <JamCard key={jam.coordinate} jam={jam} />)}
        </div>
      ) : (
        <p className="py-16 text-center text-neutral-500">
          {jams.length === 0 ? 'No mod jams yet. Be the first to run one!' : 'No mod jams match your filters.'}
        </p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className={cn('rounded-lg p-2 transition-colors', currentPage <= 1 ? 'cursor-not-allowed text-neutral-600' : 'text-neutral-400 hover:bg-[#2a2a2a]')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {pageNumbers.map((num, i) =>
            num === 'ellipsis' ? (
              <span key={`e${i}`} className="px-1 text-sm text-neutral-600">…</span>
            ) : (
              <button
                key={num}
                onClick={() => setPage(num)}
                className={cn(
                  'h-8 w-8 rounded-lg text-sm font-medium transition-colors',
                  num === currentPage ? 'bg-[#fc4462] text-white' : 'text-neutral-400 hover:bg-[#2a2a2a]',
                )}
              >
                {num}
              </button>
            ),
          )}

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages && reachedEnd}
            className={cn('rounded-lg p-2 transition-colors', currentPage >= totalPages && reachedEnd ? 'cursor-not-allowed text-neutral-600' : 'text-neutral-400 hover:bg-[#2a2a2a]')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {loadingMore && (
        <div className="flex items-center justify-center gap-2 py-1 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading more jams…
        </div>
      )}
    </div>
  )
}
