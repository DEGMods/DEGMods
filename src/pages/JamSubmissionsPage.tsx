import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { ChevronLeft, ChevronRight, ChevronDown, Check, Loader2, ArrowLeft, Plus, Medal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ModCard } from '@/components/mod/ModCard'
import { SearchBar } from '@/components/search/SearchBar'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchAllEvents, fetchEvents, fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { getCachedEvent, whenEventCacheReady } from '@/lib/nostr/eventCache'
import { extractModData } from '@/lib/nostr/events'
import { extractJam, isValidSubmission, jamStatus, submissionWindow, JAM_ENTRY_LABEL, type JamDetails } from '@/lib/nostr/jam'
import { mergeResultPages, type JamResultRow } from '@/lib/nostr/jamVoting'
import { useModerationFilter } from '@/hooks/useModeration'
import { useBlockFilter } from '@/hooks/useBlock'
import { useWotModFilter } from '@/hooks/useWot'
import { KINDS } from '@/lib/constants'
import type { ModDetails } from '@/types/mod'
import { cn } from '@/lib/utils'

const PER_PAGE = 20

type SortKey = 'newest' | 'oldest' | 'title'

/** A dropdown select matching the filter menus used elsewhere in the client. */
function FilterSelect({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  const current = options.find((o) => o.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="group inline-flex items-center gap-1.5 rounded-lg border border-[#262626] bg-[#1c1c1c] px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-[#404040] focus:outline-none">
          {current?.label ?? options[0]?.label}
          <ChevronDown className="h-4 w-4 text-neutral-400 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto border-[#262626] bg-[#1c1c1c]">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => onChange(o.value)} className="cursor-pointer justify-between gap-6 text-neutral-200">
            {o.label}
            {value === o.value && <Check className="h-4 w-4 text-[#fc4462]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function JamSubmissionsPage() {
  const { naddr } = useParams<{ naddr: string }>()

  const [jam, setJam] = useState<JamDetails | null>(null)
  const [mods, setMods] = useState<ModDetails[]>([])
  const [results, setResults] = useState<Map<string, JamResultRow>>(new Map())
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [search, setSearch] = useState('')
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

    /** Entries, bounded at the relay to the window a valid submission must fall in. */
    const loadEntries = async (jamData: JamDetails) => {
      try {
        const { since, until } = submissionWindow(jamData)
        const subEvents = await fetchAllEvents(relays, { kinds: [KINDS.MOD], '#a': [coordinate], '#l': [JAM_ENTRY_LABEL], since, until })
        if (cancelled) return
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
        /* keep whatever we already have — the jam itself still resolved */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const loadResults = (jamData: JamDetails) => {
      fetchEvents([...new Set([...relays, ...jamData.relays])], { kinds: [KINDS.JAM_RESULT], authors: [pubkey], '#a': [coordinate] })
        .then((evs) => { if (!cancelled) setResults(mergeResultPages(evs)) })
        .catch(() => { /* no results yet */ })
    }

    ;(async () => {
      // 1. The jam is usually already cached (the user just came from its post),
      // so its window is on hand and entries can load without a round trip first.
      await whenEventCacheReady
      if (cancelled) return
      const cachedEv = getCachedEvent(coordinate)
      const cachedJam = cachedEv ? extractJam(cachedEv) : null
      if (cachedJam) { setJam(cachedJam); loadResults(cachedJam); loadEntries(cachedJam) }

      // 2. Confirm we're on the newest revision — its window bounds that query.
      try {
        const latestEv = await fetchLatestEvent(relays, { kinds: [KINDS.JAM], authors: [pubkey], '#d': [identifier] })
        if (cancelled) return
        const latestJam = latestEv ? extractJam(latestEv) : null
        if (!latestJam) { if (!cachedJam) { setNotFound(true); setLoading(false) } return }

        if (!cachedJam) { setJam(latestJam); loadResults(latestJam); loadEntries(latestJam); return }
        // Cached copy was stale: refresh it, and only re-query entries if the
        // window actually moved (that's the only thing bounding the query).
        if (latestEv!.created_at > cachedEv!.created_at) {
          setJam(latestJam)
          if (latestJam.start !== cachedJam.start || latestJam.end !== cachedJam.end) loadEntries(latestJam)
        }
      } catch {
        if (!cancelled && !cachedJam) { setNotFound(true); setLoading(false) }
      }
    })()

    return () => { cancelled = true }
  }, [naddr])

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
    result = [...result].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title)
      if (sort === 'oldest') return a.publishedAt - b.publishedAt
      return b.publishedAt - a.publishedAt
    })
    return result
  }, [mods, moderate, blockFilter, wotFilter, search, sort])

  useEffect(() => { setPage(1) }, [search, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE)

  if (notFound) return <div className="py-24 text-center text-neutral-400">Mod jam not found.</div>

  const status = jam ? jamStatus(jam, Math.floor(Date.now() / 1000)) : null
  const canSubmit = status === 'active'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/mod-jam/${naddr}`} className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-[#fc4462]">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to the jam
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-white">Submissions</h1>
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
          <span className="ml-auto flex items-center gap-2">
            <span className="text-neutral-500">Sort</span>
            <FilterSelect
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              options={[{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }, { value: 'title', label: 'Title A–Z' }]}
            />
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
          {paginated.map((mod) => {
            const rank = results.get(mod.aTag)
            const showRank = rank && (rank.jRank > 0 || rank.uRank > 0)
            return (
              <div key={mod.aTag} className="relative">
                {showRank && (
                  <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col gap-1">
                    {jam?.votingEnabled && rank!.jRank > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 backdrop-blur-sm"><Medal className="h-3 w-3" /> Judges’ #{rank!.jRank}</span>
                    )}
                    {jam?.userVotingEnabled && rank!.uRank > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-sky-300 backdrop-blur-sm"><Medal className="h-3 w-3" /> Community #{rank!.uRank}</span>
                    )}
                  </div>
                )}
                <ModCard mod={mod} />
              </div>
            )
          })}
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
