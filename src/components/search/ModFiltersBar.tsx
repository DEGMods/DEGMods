import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, Boxes, Tag as TagIcon, EyeOff, Plus, X, FolderTree, ChevronRight, ChevronDown, Check, Trash2, Users, Settings2, Repeat2, Joystick, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CATEGORY_MAX_DEPTH, CATEGORY_SEGMENT_MAXLEN } from '@/lib/constants'
import {
  useModFiltersStore, UNTAGGED, BUILTIN_SOURCES, DEFAULT_MIN_POW,
  type NsfwMode, type RepostMode, type EmulationMode, type LegacyMode, type SourceEntry,
} from '@/stores/modFiltersStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useModerationStore } from '@/stores/moderationStore'
import { useWotStore } from '@/stores/wotStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

const NSFW_OPTIONS: { value: NsfwMode; label: string }[] = [
  { value: 'hide', label: 'Hide NSFW' },
  { value: 'show', label: 'Show NSFW' },
  { value: 'only', label: 'Only NSFW' },
]

const REPOST_OPTIONS: { value: RepostMode; label: string; desc: string }[] = [
  { value: 'originals', label: 'Originals', desc: 'Only original mods — hide reposts.' },
  { value: 'show', label: 'Show Reposts', desc: 'Show both originals and reposts.' },
  { value: 'only', label: 'Only Reposts', desc: 'Show only reposts.' },
]

const EMULATION_OPTIONS: { value: EmulationMode; label: string; desc: string }[] = [
  { value: 'native', label: 'Native games', desc: 'Mods for games released natively on PC.' },
  { value: 'show', label: 'Show emulated games', desc: "Also include mods for games that aren't on PC natively but have an emulated version." },
  { value: 'only', label: 'Only emulated games', desc: 'Only mods for emulated games.' },
]

// LEGACY: old kind-30402 mod visibility
const LEGACY_OPTIONS: { value: LegacyMode; label: string; desc: string }[] = [
  { value: 'show', label: 'Show legacy', desc: 'Include mods from the old DEG Mods post structure (tagged “Legacy”).' },
  { value: 'hide', label: 'Hide legacy', desc: 'Hide mods from the old post structure.' },
  { value: 'only', label: 'Only legacy', desc: 'Show only mods from the old post structure.' },
]

interface ModFiltersBarProps {
  /** Distinct client names found in the loaded mods, for the Sources picker. */
  availableClients: string[]
  resultCount: number
  /** NIP-45 totals from the relays (current kind-31142 + legacy kind-30402). When
   *  provided, shown instead of the loaded-count. */
  currentCount?: number
  legacyCount?: number
  /** How many mods in this listing are hidden by the user's Web of Trust. */
  wotHiddenCount?: number
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
          ? 'border-purple-500/40 bg-purple-500/10 text-purple-300'
          : 'border-[#262626] text-neutral-300 hover:border-[#404040]',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
      {count !== undefined && <span className="text-xs tabular-nums opacity-70">{count}</span>}
    </button>
  )
}

export function TagEditor({ tags, onChange, placeholder }: {
  tags: string[]
  onChange: (t: string[]) => void
  placeholder: string
}) {
  const [input, setInput] = useState('')
  const add = () => {
    const v = input.trim().toLowerCase()
    setInput('')
    if (!v || tags.includes(v)) return
    onChange([...tags, v])
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder}
          className="bg-[#212121] border-[#262626] text-white"
        />
        <Button onClick={add} disabled={!input.trim()} className="shrink-0 bg-purple-600 hover:bg-purple-700">
          <Plus size={14} className="mr-1" /> Add
        </Button>
      </div>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 rounded-md border border-[#262626] bg-[#212121] px-2 py-1 text-sm text-neutral-200">
              {t}
              <button onClick={() => onChange(tags.filter((x) => x !== t))} className="text-neutral-500 hover:text-red-400">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-600">None yet.</p>
      )}
    </div>
  )
}

export function SourcesEditor({ sources, onChange, availableClients }: {
  sources: SourceEntry[]
  onChange: (s: SourceEntry[]) => void
  availableClients: string[]
}) {
  const [input, setInput] = useState('')
  const addSource = (name: string) => {
    const v = name.trim()
    if (!v || sources.some((s) => s.name.toLowerCase() === v.toLowerCase())) return
    onChange([...sources, { name: v, enabled: true }])
  }
  const discovered = availableClients.filter(
    (c) => !sources.some((s) => s.name.toLowerCase() === c.toLowerCase()),
  )
  const toggle = (name: string) => onChange(sources.map((x) => x.name === name ? { ...x, enabled: !x.enabled } : x))

  const builtins = sources.filter((s) => BUILTIN_SOURCES.includes(s.name))
  const untagged = sources.find((s) => s.name === UNTAGGED)
  const customs = sources.filter((s) => !BUILTIN_SOURCES.includes(s.name) && s.name !== UNTAGGED)

  const Row = (s: SourceEntry, removable: boolean) => (
    <div key={s.name} className="flex items-center gap-3">
      <Switch checked={s.enabled} onCheckedChange={() => toggle(s.name)} />
      <span className="flex-1 text-sm text-neutral-200">
        {s.name === UNTAGGED ? 'Untagged (no client)' : s.name}
      </span>
      {removable && (
        <button onClick={() => onChange(sources.filter((x) => x.name !== s.name))} className="text-neutral-500 hover:text-red-400">
          <X size={14} />
        </button>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="space-y-2">{builtins.map((s) => Row(s, false))}</div>

      {untagged && (
        <>
          <div className="h-px bg-[#262626]" />
          {Row(untagged, false)}
        </>
      )}

      {customs.length > 0 && (
        <>
          <div className="h-px bg-[#262626]" />
          <div className="space-y-2">{customs.map((s) => Row(s, true))}</div>
        </>
      )}

      {discovered.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-neutral-500">Discovered sources</p>
          <div className="flex flex-wrap gap-2">
            {discovered.map((c) => (
              <button
                key={c}
                onClick={() => addSource(c)}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-[#333] px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-[#444] hover:text-neutral-200"
              >
                <Plus size={12} /> {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSource(input); setInput('') } }}
          placeholder="Add a custom source (client name)"
          className="bg-[#212121] border-[#262626] text-white"
        />
        <Button onClick={() => { addSource(input); setInput('') }} disabled={!input.trim()} className="shrink-0 bg-purple-600 hover:bg-purple-700">
          <Plus size={14} className="mr-1" /> Add
        </Button>
      </div>
    </div>
  )
}


export function CategoryChainsEditor({ chains, onChange }: { chains: string[]; onChange: (c: string[]) => void }) {
  const getSegs = (c: string) => (c === '' ? [''] : c.split(':'))
  const updateSeg = (ci: number, si: number, v: string) => {
    const segs = getSegs(chains[ci])
    segs[si] = v.replace(/:/g, '')
    const next = [...chains]; next[ci] = segs.join(':'); onChange(next)
  }
  const addSeg = (ci: number) => {
    const segs = getSegs(chains[ci])
    if (segs.length >= CATEGORY_MAX_DEPTH) return
    const next = [...chains]; next[ci] = [...segs, ''].join(':'); onChange(next)
  }
  const removeSeg = (ci: number, si: number) => {
    const segs = getSegs(chains[ci]).filter((_, j) => j !== si)
    const next = [...chains]; next[ci] = (segs.length ? segs : ['']).join(':'); onChange(next)
  }

  return (
    <div className="space-y-3">
      {chains.map((cat, i) => {
        const segments = getSegs(cat)
        return (
          <div key={i} className="rounded-lg border border-[#262626] bg-[#171717] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                {segments.map((seg, j) => (
                  <div key={j} className="flex items-center gap-2">
                    {j > 0 && <ChevronRight className="h-4 w-4 shrink-0 text-neutral-600" />}
                    <div className="flex items-center rounded-md bg-[#212121] pr-1">
                      <Input
                        value={seg}
                        onChange={(e) => updateSeg(i, j, e.target.value)}
                        placeholder={j === 0 ? 'Category' : 'Subcategory'}
                        maxLength={CATEGORY_SEGMENT_MAXLEN}
                        className="w-36 border-0 bg-transparent text-white focus-visible:ring-0"
                      />
                      {segments.length > 1 && (
                        <button type="button" onClick={() => removeSeg(i, j)} className="shrink-0 p-1 text-neutral-500 hover:text-red-400" aria-label="Remove level">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {segments.length < CATEGORY_MAX_DEPTH && (
                  <button type="button" onClick={() => addSeg(i)} className="inline-flex items-center gap-1 rounded-md border border-dashed border-[#333] px-2 py-1.5 text-xs text-neutral-400 hover:border-[#444] hover:text-neutral-200">
                    <Plus size={12} /> level
                  </button>
                )}
              </div>
              <button type="button" onClick={() => onChange(chains.filter((_, x) => x !== i))} className="shrink-0 rounded p-1.5 text-neutral-500 hover:bg-[#2a2a2a] hover:text-red-400" aria-label="Remove category">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...chains, ''])} className="border-[#262626] bg-transparent text-xs text-neutral-400 hover:bg-[#2a2a2a]">
        <Plus size={14} className="mr-1" /> Add Category
      </Button>
    </div>
  )
}

export function ModFiltersBar({ availableClients, resultCount, currentCount, legacyCount, wotHiddenCount = 0 }: ModFiltersBarProps) {
  const {
    nsfwMode, setNsfwMode, sources, setSources,
    searchTags, setSearchTags, excludedTags, setExcludedTags, resetExcludedTags,
    categoryFilters, setCategoryFilters, repostMode, setRepostMode,
    emulationMode, setEmulationMode,
    legacyMode, setLegacyMode, // LEGACY
  } = useModFiltersStore()
  // Viewing-PoW is shared with Settings (single source of truth).
  const minPow = useSettingsStore((s) => s.powFilterDifficulty)
  const setMinPow = useSettingsStore((s) => s.setPowFilterDifficulty)
  const moderationDefaults = useModerationStore((s) => s.excludedTags)
  const wotApplyMods = useWotStore((s) => s.settings.applyMods)
  const updateWot = useWotStore((s) => s.updateSettings)

  const [powOpen, setPowOpen] = useState(false)
  const [repostOpen, setRepostOpen] = useState(false)
  const [emulationOpen, setEmulationOpen] = useState(false)
  const [legacyOpen, setLegacyOpen] = useState(false) // LEGACY
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [excludedOpen, setExcludedOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [moderatedOpen, setModeratedOpen] = useState(false)

  const enabledSources = sources.filter((s) => s.enabled).length
  const activeCategories = categoryFilters.filter((c) => c.split(':').some(Boolean)).length

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
          <DropdownMenuContent
            align="start"
            className="min-w-[var(--radix-dropdown-menu-trigger-width)] bg-[#1c1c1c] border-[#262626]"
          >
            {NSFW_OPTIONS.map((o) => (
              <DropdownMenuItem
                key={o.value}
                onClick={() => setNsfwMode(o.value)}
                className="cursor-pointer justify-between gap-6 text-neutral-200"
              >
                {o.label}
                {nsfwMode === o.value && <Check className="h-4 w-4 text-purple-400" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <FilterButton icon={Boxes} label="Sources" count={enabledSources} onClick={() => setSourcesOpen(true)} />
        <FilterButton icon={FolderTree} label="Categories" count={activeCategories} onClick={() => setCategoriesOpen(true)} />
        <FilterButton icon={TagIcon} label="Tags" count={searchTags.length} onClick={() => setTagsOpen(true)} />
        <FilterButton icon={EyeOff} label="Excluded" count={excludedTags.length} onClick={() => setExcludedOpen(true)} />
        <FilterButton icon={Users} label={wotApplyMods ? 'Moderated' : 'Unmoderated'} onClick={() => setModeratedOpen(true)} />
        <FilterButton icon={Repeat2} label={REPOST_OPTIONS.find((o) => o.value === repostMode)?.label ?? 'Reposts'} onClick={() => setRepostOpen(true)} />
        <FilterButton icon={Joystick} label={EMULATION_OPTIONS.find((o) => o.value === emulationMode)?.label ?? 'Emulation'} onClick={() => setEmulationOpen(true)} />
        {/* LEGACY: old kind-30402 mods */}
        <FilterButton icon={History} label={LEGACY_OPTIONS.find((o) => o.value === legacyMode)?.label ?? 'Legacy'} onClick={() => setLegacyOpen(true)} />
        <FilterButton icon={ShieldCheck} label="PoW" count={minPow > 0 ? minPow : undefined} onClick={() => setPowOpen(true)} />

        <span className="ml-auto text-sm text-neutral-500">
          {currentCount !== undefined ? (
            <>at least {currentCount} {currentCount === 1 ? 'mod' : 'mods'}{legacyCount ? `, ${legacyCount} legacy mods` : ''}</>
          ) : (
            <>at least {resultCount} {resultCount === 1 ? 'mod' : 'mods'}</>
          )}
        </span>
      </div>

      {/* Moderated / Unmoderated (Web of Trust) modal */}
      <Dialog open={moderatedOpen} onOpenChange={setModeratedOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Moderation (Web of Trust)</DialogTitle>
            <DialogDescription className="text-neutral-400">
              This uses your personal Web of Trust to hide mods from users your network doesn't trust.
              It's configured in Settings, Moderation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-2">
              {([
                { on: true, label: 'Moderated', desc: 'Hide low-trust mods' },
                { on: false, label: 'Unmoderated', desc: 'Show everything' },
              ] as const).map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => updateWot({ applyMods: opt.on })}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-left transition-colors',
                    wotApplyMods === opt.on
                      ? 'border-purple-500/50 bg-purple-500/10'
                      : 'border-[#262626] hover:border-[#404040]',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-neutral-100">{opt.label}</span>
                    {wotApplyMods === opt.on && <Check className="h-4 w-4 text-purple-400" />}
                  </div>
                  <span className="text-xs text-neutral-500">{opt.desc}</span>
                </button>
              ))}
            </div>

            <p className="text-xs leading-relaxed text-neutral-500">
              Example: a mod by someone none of your follows follow, and whom some of your follows have
              publicly muted, scores below your threshold and is hidden. People you follow are never hidden.
            </p>

            <div className="rounded-md border border-[#262626] bg-[#212121] px-3 py-2 text-sm text-neutral-300">
              {wotHiddenCount > 0
                ? `${wotHiddenCount} ${wotHiddenCount === 1 ? 'mod is' : 'mods are'} ${wotApplyMods ? 'hidden' : 'flagged low-trust'} here by your Web of Trust.`
                : 'No mods are hidden here by your Web of Trust.'}
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

      {/* Reposts modal */}
      <Dialog open={repostOpen} onOpenChange={setRepostOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Reposts</DialogTitle>
            <DialogDescription className="text-neutral-400">
              A repost is a mod re-shared by someone other than the original author. Choose how they appear in this listing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            {REPOST_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRepostMode(opt.value)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                  repostMode === opt.value
                    ? 'border-purple-500/50 bg-purple-500/10'
                    : 'border-[#262626] hover:border-[#404040]',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-100">{opt.label}</span>
                  {repostMode === opt.value && <Check className="h-4 w-4 text-purple-400" />}
                </div>
                <span className="text-xs text-neutral-500">{opt.desc}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Emulation modal */}
      <Dialog open={emulationOpen} onOpenChange={setEmulationOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Emulated games</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Some mods target games played through an emulator rather than a native PC release. Choose what to show.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            {EMULATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setEmulationMode(opt.value)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                  emulationMode === opt.value
                    ? 'border-purple-500/50 bg-purple-500/10'
                    : 'border-[#262626] hover:border-[#404040]',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-100">{opt.label}</span>
                  {emulationMode === opt.value && <Check className="h-4 w-4 text-purple-400" />}
                </div>
                <span className="text-xs text-neutral-500">{opt.desc}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* LEGACY modal — old kind-30402 mods */}
      <Dialog open={legacyOpen} onOpenChange={setLegacyOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Legacy mods</DialogTitle>
            <DialogDescription className="text-neutral-400">
              DEG Mods migrated to a new dedicated post structure for mods. These are mods from the old system. Choose what to show.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            {LEGACY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setLegacyMode(opt.value)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                  legacyMode === opt.value
                    ? 'border-purple-500/50 bg-purple-500/10'
                    : 'border-[#262626] hover:border-[#404040]',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-100">{opt.label}</span>
                  {legacyMode === opt.value && <Check className="h-4 w-4 text-purple-400" />}
                </div>
                <span className="text-xs text-neutral-500">{opt.desc}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* PoW modal */}
      <Dialog open={powOpen} onOpenChange={setPowOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Minimum Proof of Work</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Hide mods whose event ID doesn't meet this PoW difficulty, a spam deterrent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-300">Difficulty</span>
              <span className="font-mono text-purple-400">{minPow} bits</span>
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
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Sources</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Choose which clients' mods to show (by their <code>client</code> tag).
            </DialogDescription>
          </DialogHeader>
          <SourcesEditor sources={sources} onChange={setSources} availableClients={availableClients} />
        </DialogContent>
      </Dialog>

      {/* Categories modal */}
      <Dialog open={categoriesOpen} onOpenChange={setCategoriesOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Filter by categories</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Show only mods under these category chains (matches the chain or anything below it).
            </DialogDescription>
          </DialogHeader>
          <CategoryChainsEditor chains={categoryFilters} onChange={setCategoryFilters} />
        </DialogContent>
      </Dialog>

      {/* Tags modal */}
      <Dialog open={tagsOpen} onOpenChange={setTagsOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Filter by tags</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Show only mods that have at least one of these tags.
            </DialogDescription>
          </DialogHeader>
          <TagEditor tags={searchTags} onChange={setSearchTags} placeholder="Add a tag to include…" />
        </DialogContent>
      </Dialog>

      {/* Excluded tags modal */}
      <Dialog open={excludedOpen} onOpenChange={setExcludedOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Excluded tags</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Hide any mod that has one of these tags (filtered locally).
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
