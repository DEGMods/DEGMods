import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Boxes, Tag as TagIcon, EyeOff, Users, ShieldCheck, Check, ChevronDown, Settings2, CalendarClock, CalendarRange,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { TagEditor, SourcesEditor } from '@/components/search/ModFiltersBar'
import { MonthPicker } from '@/components/jam/MonthPicker'
import { useJamFiltersStore, type JamStatusFilter, type FiltersStore } from '@/stores/jamFiltersStore'
import { requestAdult } from '@/stores/ageGateStore'
import { DEFAULT_MIN_POW, type NsfwMode } from '@/stores/modFiltersStore'
import { MAX_SPAN, addMonths, effectiveRange } from '@/lib/jams/monthRange'
import { monthLabel } from '@/lib/nostr/jam'
import { useSettingsStore } from '@/stores/settingsStore'
import { useModerationStore } from '@/stores/moderationStore'
import { useWotStore } from '@/stores/wotStore'
import { cn } from '@/lib/utils'

const NSFW_OPTIONS: { value: NsfwMode; label: string }[] = [
  { value: 'hide', label: 'Hide NSFW' },
  { value: 'show', label: 'Show NSFW' },
  { value: 'only', label: 'Only NSFW' },
]

const STATUS_OPTIONS: { value: JamStatusFilter; label: string; desc: string }[] = [
  { value: 'all', label: 'All', desc: 'Every jam' },
  { value: 'active', label: 'Active', desc: 'Open for submissions' },
  { value: 'upcoming', label: 'Upcoming', desc: 'Not started yet' },
  { value: 'voting', label: 'Voting', desc: 'Submissions closed, being judged' },
  { value: 'ended', label: 'Ended', desc: 'Finished' },
]

interface JamFiltersBarProps {
  /** Distinct client names found in the loaded jams, for the Sources picker. */
  availableClients: string[]
  resultCount: number
  /** How many jams in this listing are hidden by the user's Web of Trust. */
  wotHiddenCount?: number
  /**
   * Which filter store to drive. Defaults to the jam listing's; the submissions
   * listing passes its own so narrowing entries inside a jam doesn't reshape
   * /mod-jams.
   */
  store?: FiltersStore
  /** Status and date range only make sense for the jam listing itself. */
  showStatus?: boolean
  showRange?: boolean
  /** What the result count is counting. */
  noun?: [singular: string, plural: string]
}

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
        active
          ? 'border-[#fc4462]/40 bg-[#fc4462]/10 text-[#fc9db0]'
          : 'border-[#262626] text-neutral-300 hover:border-[#404040]',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
      {count !== undefined && <span className="text-xs tabular-nums opacity-70">{count}</span>}
    </button>
  )
}

export function JamFiltersBar({
  availableClients, resultCount, wotHiddenCount = 0,
  store = useJamFiltersStore, showStatus = true, showRange = true, noun = ['jam', 'jams'],
}: JamFiltersBarProps) {
  const {
    nsfwMode, setNsfwMode, status, setStatus, fromMonth, toMonth, setRange, sources, setSources,
    searchTags, setSearchTags, excludedTags, setExcludedTags, resetExcludedTags,
  } = store()
  // Viewing-PoW is shared with Settings (single source of truth).
  const minPow = useSettingsStore((s) => s.powFilterDifficulty)
  const setMinPow = useSettingsStore((s) => s.setPowFilterDifficulty)
  const moderationDefaults = useModerationStore((s) => s.excludedTags)
  const wotApplyMods = useWotStore((s) => s.settings.applyMods)
  const updateWot = useWotStore((s) => s.updateSettings)

  const [statusOpen, setStatusOpen] = useState(false)
  const [rangeOpen, setRangeOpen] = useState(false)
  const [powOpen, setPowOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [excludedOpen, setExcludedOpen] = useState(false)
  const [moderatedOpen, setModeratedOpen] = useState(false)

  // The range is drafted in the modal and only committed on Apply, so picking
  // months doesn't refire the relay query on every click.
  const [draftFrom, setDraftFrom] = useState(fromMonth)
  const [draftTo, setDraftTo] = useState(toMonth)
  const openRange = () => { setDraftFrom(fromMonth); setDraftTo(toMonth); setRangeOpen(true) }
  const applyRange = () => { setRange(draftFrom, draftTo); setRangeOpen(false) }
  const resetRange = () => { setDraftFrom(''); setDraftTo(''); setRange('', '') }

  const enabledSources = sources.filter((s) => s.enabled).length
  const currentStatus = STATUS_OPTIONS.find((o) => o.value === status) ?? STATUS_OPTIONS[0]
  const range = effectiveRange(fromMonth, toMonth)
  const draftRange = effectiveRange(draftFrom, draftTo)

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
                // 'hide' needs no check; asking to see NSFW does.
                onClick={() => o.value === 'hide'
                  ? setNsfwMode(o.value)
                  : requestAdult(() => setNsfwMode(o.value))}
                className="cursor-pointer justify-between gap-6 text-neutral-200"
              >
                {o.label}
                {nsfwMode === o.value && <Check className="h-4 w-4 text-[#fc4462]" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {showStatus && <FilterButton icon={CalendarClock} label={`Status: ${currentStatus.label}`} active={status !== 'all'} onClick={() => setStatusOpen(true)} />}
        {showRange && (
          <FilterButton
            icon={CalendarRange}
            label={range ? `Range: ${monthLabel(range.from)} – ${monthLabel(range.to)}` : 'Range'}
            active={!!range}
            onClick={openRange}
          />
        )}
        <FilterButton icon={Boxes} label="Sources" count={enabledSources} onClick={() => setSourcesOpen(true)} />
        <FilterButton icon={TagIcon} label="Tags" count={searchTags.length} onClick={() => setTagsOpen(true)} />
        <FilterButton icon={EyeOff} label="Excluded" count={excludedTags.length} onClick={() => setExcludedOpen(true)} />
        <FilterButton icon={Users} label={wotApplyMods ? 'Moderated' : 'Unmoderated'} onClick={() => setModeratedOpen(true)} />
        <FilterButton icon={ShieldCheck} label="PoW" count={minPow > 0 ? minPow : undefined} onClick={() => setPowOpen(true)} />

        <span className="ml-auto text-sm text-neutral-500">
          at least {resultCount} {resultCount === 1 ? noun[0] : noun[1]}
        </span>
      </div>

      {/* Status modal */}
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Jam status</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Show only jams at this point in their lifecycle.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-1">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setStatus(opt.value); setStatusOpen(false) }}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left transition-colors',
                  status === opt.value ? 'border-[#fc4462]/50 bg-[#fc4462]/10' : 'border-[#262626] hover:border-[#404040]',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-100">{opt.label}</span>
                  {status === opt.value && <Check className="h-4 w-4 text-[#fc4462]" />}
                </div>
                <span className="text-xs text-neutral-500">{opt.desc}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Month range modal */}
      <Dialog open={rangeOpen} onOpenChange={setRangeOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Month range</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Show only jams running in these months. Leave both empty to browse the newest jams.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span className="w-8">From</span>
              <MonthPicker
                value={draftFrom}
                onChange={setDraftFrom}
                placeholder="Any month"
                minMonth={draftTo ? addMonths(draftTo, -(MAX_SPAN - 1)) : undefined}
                maxMonth={draftTo || undefined}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span className="w-8">To</span>
              <MonthPicker
                value={draftTo}
                onChange={setDraftTo}
                placeholder="Any month"
                minMonth={draftFrom || undefined}
                maxMonth={draftFrom ? addMonths(draftFrom, MAX_SPAN - 1) : undefined}
              />
            </div>

            <p className="text-[11px] leading-relaxed text-neutral-500">
              {draftRange
                ? `Filtering ${monthLabel(draftRange.from)} – ${monthLabel(draftRange.to)}.`
                : 'No range set — browsing the newest jams.'}
              {' '}Up to {MAX_SPAN} months at a time; setting just one end fills in the rest.
            </p>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={resetRange} disabled={!draftFrom && !draftTo} className="border-[#262626] text-xs text-neutral-300">
                Reset
              </Button>
              <Button size="sm" onClick={applyRange} className="bg-[#fc4462] text-xs text-white hover:bg-[#e23a56]">
                Apply
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Moderated / Unmoderated (Web of Trust) modal */}
      <Dialog open={moderatedOpen} onOpenChange={setModeratedOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Moderation (Web of Trust)</DialogTitle>
            <DialogDescription className="text-neutral-400">
              This uses your personal Web of Trust to hide jams from users your network doesn't trust.
              It's configured in Settings, Moderation, and shared with the mod listings.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-2">
              {([
                { on: true, label: 'Moderated', desc: 'Hide low-trust jams' },
                { on: false, label: 'Unmoderated', desc: 'Show everything' },
              ] as const).map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => updateWot({ applyMods: opt.on })}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-left transition-colors',
                    wotApplyMods === opt.on ? 'border-[#fc4462]/50 bg-[#fc4462]/10' : 'border-[#262626] hover:border-[#404040]',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-neutral-100">{opt.label}</span>
                    {wotApplyMods === opt.on && <Check className="h-4 w-4 text-[#fc4462]" />}
                  </div>
                  <span className="text-xs text-neutral-500">{opt.desc}</span>
                </button>
              ))}
            </div>

            <div className="rounded-md border border-[#262626] bg-[#212121] px-3 py-2 text-sm text-neutral-300">
              {wotHiddenCount > 0
                ? `${wotHiddenCount} ${wotHiddenCount === 1 ? 'jam is' : 'jams are'} ${wotApplyMods ? 'hidden' : 'flagged low-trust'} here by your Web of Trust.`
                : 'No jams are hidden here by your Web of Trust.'}
            </div>

            <Link
              to="/settings?tab=moderation"
              onClick={() => setModeratedOpen(false)}
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-[#262626] px-2.5 py-1.5 text-sm text-neutral-200 transition-colors hover:border-[#404040] hover:text-white"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Web of Trust settings
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      {/* PoW modal */}
      <Dialog open={powOpen} onOpenChange={setPowOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Minimum Proof of Work</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Hide jams whose event ID doesn't meet this PoW difficulty, a spam deterrent. Shared with the mod listings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-300">Difficulty</span>
              <span className="font-mono text-[#fc4462]">{minPow} bits</span>
            </div>
            <Slider min={0} max={32} step={1} value={[minPow]} onValueChange={([v]) => setMinPow(v)} />
            <Button variant="outline" size="sm" onClick={() => setMinPow(DEFAULT_MIN_POW)} className="w-fit border-[#262626] text-xs text-neutral-300">
              Reset to default ({DEFAULT_MIN_POW})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sources modal */}
      <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Sources</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Choose which clients' jams to show (by their <code>client</code> tag).
            </DialogDescription>
          </DialogHeader>
          <SourcesEditor sources={sources} onChange={setSources} availableClients={availableClients} />
        </DialogContent>
      </Dialog>

      {/* Tags modal */}
      <Dialog open={tagsOpen} onOpenChange={setTagsOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Filter by tags</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Show only jams that have at least one of these tags.
            </DialogDescription>
          </DialogHeader>
          <TagEditor tags={searchTags} onChange={setSearchTags} placeholder="Add a tag to include…" />
        </DialogContent>
      </Dialog>

      {/* Excluded tags modal */}
      <Dialog open={excludedOpen} onOpenChange={setExcludedOpen}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Excluded tags</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Hide any jam that has one of these tags (filtered locally).
            </DialogDescription>
          </DialogHeader>
          <TagEditor tags={excludedTags} onChange={setExcludedTags} placeholder="Add a tag to exclude…" />
          <Button variant="outline" size="sm" onClick={() => resetExcludedTags(moderationDefaults)} className="mt-1 w-fit border-[#262626] text-xs text-neutral-300">
            Reset to defaults
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
