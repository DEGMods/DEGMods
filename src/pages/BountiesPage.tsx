import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Filter } from 'nostr-tools'
import { Search, Plus, Gamepad2, CheckCircle2, CircleDashed, Gift, PackagePlus } from 'lucide-react'
import { KINDS } from '@/lib/constants'
import { useProgressiveEvents } from '@/hooks/useProgressiveEvents'
import { constructBountyListFromEvents, type BountyDetails } from '@/lib/nostr/bounty'
import { useSeoMeta } from '@/hooks/useSeoMeta'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { cn } from '@/lib/utils'

const BATCH = 60
type StatusFilter = 'all' | 'open' | 'fulfilled'

export function BountiesPage() {
  useSeoMeta({ title: 'Mod Requests', description: 'Requested mods people want, for the games they play.' })

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')

  const filter = useMemo<Filter>(() => ({ kinds: [KINDS.BOUNTY] }), [])
  const { events, loading } = useProgressiveEvents(filter, BATCH)
  const bounties = useMemo(() => constructBountyListFromEvents(events), [events])

  const filtered = useMemo(() => {
    let list = bounties
    if (status !== 'all') list = list.filter((b) => (status === 'fulfilled' ? b.fulfilled : !b.fulfilled))
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((b) =>
      b.title.toLowerCase().includes(q) ||
      b.game.toLowerCase().includes(q) ||
      b.tags.some((t) => t.toLowerCase().includes(q)),
    )
    return [...list].sort((a, b) => b.publishedAt - a.publishedAt)
  }, [bounties, status, search])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Mod Requests</h1>
        <Link to="/submit-mod-bounty">
          <Button size="sm" className="gap-1.5 bg-purple-600 text-xs text-white hover:bg-purple-700">
            <Plus size={14} /> Post request
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search requests..." className="border-[#262626] bg-[#212121] pl-9 text-white" />
        </div>
        <div className="flex gap-1 rounded-lg bg-[#212121] p-1">
          {(['all', 'open', 'fulfilled'] as StatusFilter[]).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={cn('rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors', status === s ? 'bg-purple-600 text-white' : 'text-neutral-400 hover:text-neutral-200')}>{s}</button>
          ))}
        </div>
      </div>

      {loading && bounties.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">Loading mod requests...</p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">No mod requests{status !== 'all' ? ` (${status})` : ''} yet.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((b) => <BountyCard key={b.aTag} bounty={b} />)}
        </ol>
      )}
    </div>
  )
}

function BountyCard({ bounty: b }: { bounty: BountyDetails }) {
  return (
    <li className="flex h-full flex-col overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c] transition-colors hover:border-[#3a3a3a]">
      <Link to={`/mod-bounty/${b.naddr}`} className="flex h-full flex-col">
        <div className="relative aspect-video w-full overflow-hidden bg-[#212121]">
          {b.image ? (
            <SkeletonImage src={b.image} alt={b.title} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center"><PackagePlus className="h-8 w-8 text-neutral-700" /></div>
          )}
          <span className={cn('absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium backdrop-blur', b.fulfilled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300')}>
            {b.fulfilled ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
            {b.fulfilled ? 'Fulfilled' : 'Open'}
          </span>
        </div>
        <div className="flex flex-1 flex-col p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-neutral-400">
            <Gamepad2 className="h-3.5 w-3.5" /> <span className="truncate">{b.game}</span>
          </div>
          <h2 className="text-base font-semibold text-neutral-100">{b.title}</h2>
          {b.summary && <p className="mt-1 line-clamp-2 text-sm text-neutral-400">{b.summary}</p>}
          {b.reward && (
            <p className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-emerald-300">
              <Gift className="h-3.5 w-3.5" /> <span className="truncate">{b.reward.what}{b.reward.how ? ` (${b.reward.how})` : ''}</span>
            </p>
          )}
        </div>
      </Link>
    </li>
  )
}
