import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { ChevronLeft, ChevronRight, Loader2, ArrowLeft, Plus, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ModCard } from '@/components/mod/ModCard'
import { SearchBar } from '@/components/search/SearchBar'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchAllEvents } from '@/lib/nostr/relay-pool'
import { extractModData } from '@/lib/nostr/events'
import { extractJam, isValidSubmission, jamStatus, monthBuckets, monthKey, monthLabel, JAM_ENTRY_LABEL, type JamDetails } from '@/lib/nostr/jam'
import { useModerationFilter } from '@/hooks/useModeration'
import { useBlockFilter } from '@/hooks/useBlock'
import { useWotModFilter } from '@/hooks/useWot'
import { KINDS } from '@/lib/constants'
import type { ModDetails } from '@/types/mod'
import { cn } from '@/lib/utils'

const PER_PAGE = 20

type SortKey = 'newest' | 'oldest' | 'title'

export function JamSubmissionsPage() {
  const { naddr } = useParams<{ naddr: string }>()

  const [jam, setJam] = useState<JamDetails | null>(null)
  const [mods, setMods] = useState<ModDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [search, setSearch] = useState('')
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [page, setPage] = useState(1)

  const moderate = useModerationFilter()
  const blockFilter = useBlockFilter()
  const wotFilter = useWotModFilter()

  useEffect(() => {
    let cancelled = false
    setLoading(true); setNotFound(false); setJam(null); setMods([])
    let decoded
    try { decoded = nip19.decode(naddr!) } catch { setNotFound(true); setLoading(false); return }
    if (decoded.type !== 'naddr' || decoded.data.kind !== KINDS.JAM) { setNotFound(true); setLoading(false); return }
    const { pubkey, identifier } = decoded.data
    const coordinate = `${KINDS.JAM}:${pubkey}:${identifier}`
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')

    ;(async () => {
      try {
        // The jam itself (for the window + title) and its submissions in parallel.
        const [jamEvents, subEvents] = await Promise.all([
          fetchAllEvents(relays, { kinds: [KINDS.JAM], authors: [pubkey], '#d': [identifier] }, { maxRounds: 2 }),
          fetchAllEvents(relays, { kinds: [KINDS.MOD], '#a': [coordinate], '#l': [JAM_ENTRY_LABEL] }),
        ])
        if (cancelled) return
        const newestJam = jamEvents.sort((a, b) => b.created_at - a.created_at)[0]
        const jamData = newestJam ? extractJam(newestJam) : null
        if (!jamData) { setNotFound(true); return }
        setJam(jamData)

        // Newest event per mod coordinate.
        const byCoord = new Map<string, typeof subEvents[number]>()
        for (const ev of subEvents) {
          const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
          const key = `${ev.pubkey}:${d}`
          const cur = byCoord.get(key)
          if (!cur || ev.created_at > cur.created_at) byCoord.set(key, ev)
        }
        // Valid submissions only (published within the window, not a repost).
        const valid = [...byCoord.values()]
          .filter((ev) => !ev.tags.some((t) => t[0] === 'deleted' && t[1] === 'true'))
          .filter((ev) => isValidSubmission(ev, jamData))
          .map(extractModData)
        setMods(valid)
      } catch {
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [naddr])

  // Month options span the jam's submission window [start, end].
  const monthOptions = useMemo(() => (jam ? monthBuckets(jam.start, jam.end) : []), [jam])

  const filtered = useMemo(() => {
    let result = wotFilter(blockFilter(moderate(mods)))

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((m) =>
        m.title.toLowerCase().includes(q) ||
        m.game.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }
    if (fromMonth) result = result.filter((m) => monthKey(m.publishedAt) >= fromMonth)
    if (toMonth) result = result.filter((m) => monthKey(m.publishedAt) <= toMonth)

    result = [...result].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title)
      if (sort === 'oldest') return a.publishedAt - b.publishedAt
      return b.publishedAt - a.publishedAt
    })
    return result
  }, [mods, moderate, blockFilter, wotFilter, search, fromMonth, toMonth, sort])

  useEffect(() => { setPage(1) }, [search, fromMonth, toMonth, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE)

  if (notFound) return <div className="py-24 text-center text-neutral-400">Mod jam not found.</div>

  const status = jam ? jamStatus(jam, Math.floor(Date.now() / 1000)) : null
  const canSubmit = status === 'active'

  const selectCls = 'rounded-md border border-[#262626] bg-[#212121] px-2.5 py-1.5 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-[#fc4462]'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/mod-jam/${naddr}`} className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-[#fc4462]">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to the jam
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-white">
            <Trophy className="h-5 w-5 text-[#fc4462]" /> Submissions
          </h1>
          {jam && <p className="truncate text-sm text-neutral-400">{jam.title}</p>}
        </div>
        {canSubmit && (
          <Link to={`/submit-mod?jam=${naddr}`}>
            <Button size="sm" className="gap-1.5 bg-[#fc4462] text-xs text-white hover:bg-[#e23a56]"><Plus size={14} /> Submit an entry</Button>
          </Link>
        )}
      </div>

      {/* Search + filters */}
      <div className="space-y-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search entries by title, game, or tags…" />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-neutral-500">Published</span>
          <select value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className={selectCls}>
            <option value="">From: any</option>
            {monthOptions.map((b) => <option key={b} value={b}>{monthLabel(b)}</option>)}
          </select>
          <span className="text-neutral-600">→</span>
          <select value={toMonth} onChange={(e) => setToMonth(e.target.value)} className={selectCls}>
            <option value="">To: any</option>
            {monthOptions.map((b) => <option key={b} value={b}>{monthLabel(b)}</option>)}
          </select>
          <span className="ml-auto flex items-center gap-2">
            <span className="text-neutral-500">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectCls}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="title">Title A–Z</option>
            </select>
          </span>
        </div>
        {!loading && <p className="text-xs text-neutral-500">{filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}</p>}
      </div>

      {/* Grid */}
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
          {paginated.map((mod) => <ModCard key={mod.aTag} mod={mod} />)}
        </div>
      ) : (
        <p className="py-16 text-center text-neutral-500">
          {mods.length === 0 ? 'No submissions yet.' : 'No entries match your filters.'}
        </p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className={cn('rounded-lg p-2 transition-colors', currentPage <= 1 ? 'cursor-not-allowed text-neutral-600' : 'text-neutral-400 hover:bg-[#2a2a2a]')}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-3 text-sm text-neutral-400">{currentPage} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className={cn('rounded-lg p-2 transition-colors', currentPage >= totalPages ? 'cursor-not-allowed text-neutral-600' : 'text-neutral-400 hover:bg-[#2a2a2a]')}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
