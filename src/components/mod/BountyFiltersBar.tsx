import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, Tag as TagIcon, EyeOff, Users, ShieldCheck, Check, ChevronDown, Settings2, Gamepad2, Search, CircleDashed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { TagEditor, SourcesEditor } from '@/components/search/ModFiltersBar'
import { useBountyFiltersStore, type BountyStatusFilter } from '@/stores/bountyFiltersStore'
import { requestAdult } from '@/stores/ageGateStore'
import { DEFAULT_MIN_POW, type NsfwMode } from '@/stores/modFiltersStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useModerationStore } from '@/stores/moderationStore'
import { useWotStore } from '@/stores/wotStore'
import { useGamesDbStore } from '@/stores/gamesDbStore'
import { cn } from '@/lib/utils'

const NSFW_OPTIONS: { value: NsfwMode; label: string }[] = [
  { value: 'hide', label: 'Hide NSFW' },
  { value: 'show', label: 'Show NSFW' },
  { value: 'only', label: 'Only NSFW' },
]

const STATUS_OPTIONS: { value: BountyStatusFilter; label: string; desc: string }[] = [
  { value: 'all', label: 'All', desc: 'Every request' },
  { value: 'open', label: 'Open', desc: 'Not yet fulfilled' },
  { value: 'fulfilled', label: 'Fulfilled', desc: 'A fulfiller was picked' },
]

function FilterButton({ icon: Icon, label, count, active, onClick }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count?: number
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
        active ? 'border-purple-500/40 bg-purple-500/10 text-purple-300' : 'border-[#262626] text-neutral-300 hover:border-[#404040]',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
      {count !== undefined && <span className="text-xs tabular-nums opacity-70">{count}</span>}
    </button>
  )
}

export function BountyFiltersBar({ availableClients, resultCount, wotHiddenCount = 0 }: {
  availableClients: string[]
  resultCount: number
  wotHiddenCount?: number
}) {
  const {
    nsfwMode, setNsfwMode, status, setStatus, game, setGame, sources, setSources,
    searchTags, setSearchTags, excludedTags, setExcludedTags, resetExcludedTags,
  } = useBountyFiltersStore()
  const minPow = useSettingsStore((s) => s.powFilterDifficulty)
  const setMinPow = useSettingsStore((s) => s.setPowFilterDifficulty)
  const moderationDefaults = useModerationStore((s) => s.excludedTags)
  const wotApply = useWotStore((s) => s.settings.applyJams)
  const updateWot = useWotStore((s) => s.updateSettings)
  const searchGames = useGamesDbStore((s) => s.searchGames)

  const [statusOpen, setStatusOpen] = useState(false)
  const [gameOpen, setGameOpen] = useState(false)
  const [gameQuery, setGameQuery] = useState('')
  const [powOpen, setPowOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [excludedOpen, setExcludedOpen] = useState(false)
  const [moderatedOpen, setModeratedOpen] = useState(false)

  const enabledSources = sources.filter((s) => s.enabled).length
  const currentStatus = STATUS_OPTIONS.find((o) => o.value === status) ?? STATUS_OPTIONS[0]
  const gameResults = gameQuery.trim() ? searchGames(gameQuery).slice(0, 40) : []

  return (
    <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="group inline-flex items-center gap-1.5 rounded-lg border border-[#262626] bg-[#1c1c1c] px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-[#404040] focus:outline-none">
              {NSFW_OPTIONS.find((o) => o.value === nsfwMode)?.label}
              <ChevronDown className="h-4 w-4 text-neutral-400 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)] border-[#262626] bg-[#1c1c1c]">
            {NSFW_OPTIONS.map((o) => (
              <DropdownMenuItem
                key={o.value}
                onClick={() => o.value === 'hide' ? setNsfwMode(o.value) : requestAdult(() => setNsfwMode(o.value))}
                className="cursor-pointer justify-between gap-6 text-neutral-200"
              >
                {o.label}
                {nsfwMode === o.value && <Check className="h-4 w-4 text-purple-400" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <FilterButton icon={CircleDashed} label={`Status: ${currentStatus.label}`} active={status !== 'all'} onClick={() => setStatusOpen(true)} />
        <FilterButton icon={Gamepad2} label={game ? `Game: ${game}` : 'Game'} active={!!game} onClick={() => setGameOpen(true)} />
        <FilterButton icon={Boxes} label="Sources" count={enabledSources} onClick={() => setSourcesOpen(true)} />
        <FilterButton icon={TagIcon} label="Tags" count={searchTags.length} onClick={() => setTagsOpen(true)} />
        <FilterButton icon={EyeOff} label="Excluded" count={excludedTags.length} onClick={() => setExcludedOpen(true)} />
        <FilterButton icon={Users} label={wotApply ? 'Moderated' : 'Unmoderated'} onClick={() => setModeratedOpen(true)} />
        <FilterButton icon={ShieldCheck} label="PoW" count={minPow > 0 ? minPow : undefined} onClick={() => setPowOpen(true)} />

        <span className="ml-auto text-sm text-neutral-500">
          at least {resultCount} {resultCount === 1 ? 'request' : 'requests'}
        </span>
      </div>

      {/* Status modal */}
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Request status</DialogTitle>
            <DialogDescription className="text-neutral-400">Show only requests at this point.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 py-1">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setStatus(opt.value); setStatusOpen(false) }}
                className={cn('rounded-lg border px-3 py-2.5 text-left transition-colors', status === opt.value ? 'border-purple-500/50 bg-purple-500/10' : 'border-[#262626] hover:border-[#404040]')}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-100">{opt.label}</span>
                  {status === opt.value && <Check className="h-4 w-4 text-purple-400" />}
                </div>
                <span className="text-xs text-neutral-500">{opt.desc}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Game modal */}
      <Dialog open={gameOpen} onOpenChange={setGameOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Filter by game</DialogTitle>
            <DialogDescription className="text-neutral-400">Show only requests for one game, or all games.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <Input value={gameQuery} onChange={(e) => setGameQuery(e.target.value)} placeholder="Search games..." className="border-[#262626] bg-[#212121] pl-9 text-white" autoFocus />
            </div>
            <button
              onClick={() => { setGame(''); setGameOpen(false) }}
              className={cn('flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors', !game ? 'border-purple-500/50 bg-purple-500/10 text-neutral-100' : 'border-[#262626] text-neutral-200 hover:border-[#404040]')}
            >
              All games {!game && <Check className="h-4 w-4 text-purple-400" />}
            </button>
            {gameResults.length > 0 && (
              <ul className="max-h-72 divide-y divide-[#262626] overflow-y-auto rounded-lg border border-[#262626]">
                {gameResults.map((g) => (
                  <li key={g.name}>
                    <button
                      onClick={() => { setGame(g.name); setGameOpen(false) }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[#212121]"
                    >
                      {(g.boxartImage || g.wideImage) && <img src={g.boxartImage || g.wideImage} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}
                      <span className="truncate text-sm text-neutral-200">{g.name}</span>
                      {game === g.name && <Check className="ml-auto h-4 w-4 text-purple-400" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {gameQuery.trim() && gameResults.length === 0 && <p className="text-xs text-neutral-600">No games match "{gameQuery}".</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Moderated / Unmoderated (Web of Trust) modal */}
      <Dialog open={moderatedOpen} onOpenChange={setModeratedOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Moderation (Web of Trust)</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Uses your personal Web of Trust to hide requests from users your network doesn&rsquo;t trust. Configured in Settings, Moderation, and shared with the mod and jam listings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-2">
              {([{ on: true, label: 'Moderated', desc: 'Hide low-trust requests' }, { on: false, label: 'Unmoderated', desc: 'Show everything' }] as const).map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => updateWot({ applyJams: opt.on })}
                  className={cn('rounded-lg border px-3 py-2.5 text-left transition-colors', wotApply === opt.on ? 'border-purple-500/50 bg-purple-500/10' : 'border-[#262626] hover:border-[#404040]')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-neutral-100">{opt.label}</span>
                    {wotApply === opt.on && <Check className="h-4 w-4 text-purple-400" />}
                  </div>
                  <span className="text-xs text-neutral-500">{opt.desc}</span>
                </button>
              ))}
            </div>
            <div className="rounded-md border border-[#262626] bg-[#212121] px-3 py-2 text-sm text-neutral-300">
              {wotHiddenCount > 0
                ? `${wotHiddenCount} ${wotHiddenCount === 1 ? 'request is' : 'requests are'} ${wotApply ? 'hidden' : 'flagged low-trust'} here by your Web of Trust.`
                : 'No requests are hidden here by your Web of Trust.'}
            </div>
            <Link to="/settings?tab=moderation" onClick={() => setModeratedOpen(false)} className="inline-flex w-fit items-center gap-1.5 rounded-md border border-[#262626] px-2.5 py-1.5 text-sm text-neutral-200 transition-colors hover:border-[#404040] hover:text-white">
              <Settings2 className="h-3.5 w-3.5" /> Web of Trust settings
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      {/* PoW modal */}
      <Dialog open={powOpen} onOpenChange={setPowOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Minimum Proof of Work</DialogTitle>
            <DialogDescription className="text-neutral-400">Hide requests whose event ID doesn&rsquo;t meet this PoW difficulty, a spam deterrent. Shared with the mod and jam listings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-300">Difficulty</span>
              <span className="font-mono text-purple-400">{minPow} bits</span>
            </div>
            <Slider min={0} max={32} step={1} value={[minPow]} onValueChange={([v]) => setMinPow(v)} />
            <Button variant="outline" size="sm" onClick={() => setMinPow(DEFAULT_MIN_POW)} className="w-fit border-[#262626] text-xs text-neutral-300">Reset to default ({DEFAULT_MIN_POW})</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sources modal */}
      <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Sources</DialogTitle>
            <DialogDescription className="text-neutral-400">Choose which clients&rsquo; requests to show (by their <code>client</code> tag).</DialogDescription>
          </DialogHeader>
          <SourcesEditor sources={sources} onChange={setSources} availableClients={availableClients} />
        </DialogContent>
      </Dialog>

      {/* Tags modal */}
      <Dialog open={tagsOpen} onOpenChange={setTagsOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Filter by tags</DialogTitle>
            <DialogDescription className="text-neutral-400">Show only requests that have at least one of these tags.</DialogDescription>
          </DialogHeader>
          <TagEditor tags={searchTags} onChange={setSearchTags} placeholder="Add a tag to include..." />
        </DialogContent>
      </Dialog>

      {/* Excluded tags modal */}
      <Dialog open={excludedOpen} onOpenChange={setExcludedOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Excluded tags</DialogTitle>
            <DialogDescription className="text-neutral-400">Hide any request that has one of these tags (filtered locally).</DialogDescription>
          </DialogHeader>
          <TagEditor tags={excludedTags} onChange={setExcludedTags} placeholder="Add a tag to exclude..." />
          <Button variant="outline" size="sm" onClick={() => resetExcludedTags(moderationDefaults)} className="mt-1 w-fit border-[#262626] text-xs text-neutral-300">Reset to defaults</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
