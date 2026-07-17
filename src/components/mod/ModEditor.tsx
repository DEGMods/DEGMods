import { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from 'react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Plus,
  X,
  Eye,
  Pencil,
  ImageIcon,
  Video,
  Upload,
  AlertTriangle,
  Repeat2,
  Joystick,
  Tag,
  Download,
  Shield,
  StickyNote,
  Users,
  FolderTree,
  Gamepad2,
  Type,
  FileText,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Layers,
  Boxes,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BlossomUploadField } from '@/components/upload/BlossomUploadField'
import { EmulatedPlatformField } from '@/components/mod/EmulatedPlatformField'
import { DownloadScanReports } from '@/components/mod/DownloadScanReports'
import { IMAGE_UPLOAD_ACCEPT, MOD_FILE_UPLOAD_ACCEPT, MOD_FILE_UPLOAD_LIMIT_MB, CATEGORY_MAX_DEPTH, CATEGORY_MAX_CHAINS, CATEGORY_SEGMENT_MAXLEN } from '@/lib/constants'
import { categoryCovers } from '@/lib/nostr/events'
import { useSubmitSuggestions } from '@/hooks/useSubmitSuggestions'
import { CharCounter } from '@/components/shared/CharCounter'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { GameAutocomplete } from '@/components/shared/GameAutocomplete'
import { JamIcon } from '@/components/shared/JamIcon'
import { ScreenshotsEditor } from '@/components/shared/ScreenshotsEditor'
import { JamSubmissionField } from '@/components/mod/JamSubmissionField'
import { MarkdownToolbar } from '@/components/shared/MarkdownToolbar'
import { Markdown } from '@/components/shared/Markdown'
import type {
  ModFormState,
  DownloadEntry,
  PermissionsData,
  FormErrors,
} from '@/types/mod'
import {
  DEFAULT_PERMISSIONS,
  validateModForm,
  hasErrors,
  createEmptyFormState,
} from '@/types/mod'

// ─── Character limits ───────────────────────────────────────────────

const LIMITS = {
  game: 100,
  title: 150,
  summary: 500,
  content: 30000,
  tag: 100,
  note: 1000,
  credits: 1000,
  category: CATEGORY_SEGMENT_MAXLEN,
  featuredImage: 200,
  featuredVideo: 200,
  screenshot: 200,
  originalAuthor: 150,
  downloadUrl: 200,
  downloadTitle: 100,
  downloadVersion: 50,
  downloadNote: 250,
  forMod: 200,
  emulatedPlatform: 50,
  dependencyTitle: 50,
  dependencyValue: 200,
} as const
const MAX_SCREENSHOTS = 15
const MAX_DOWNLOADS = 10
const MAX_DEPENDENCIES = 10

// Char counter is shared with other editors.
const Counter = CharCounter

/** Extract a lowercase SHA-256 from a hash-addressed URL (…/<hash>[.ext]), else null. */
function hashFromUrl(url: string): string | null {
  try {
    const seg = new URL(url).pathname.split('/').pop() ?? ''
    const base = seg.replace(/\.[a-z0-9]+$/i, '')
    return /^[a-f0-9]{64}$/i.test(base) ? base.toLowerCase() : null
  } catch {
    return null
  }
}

// ─── Props ──────────────────────────────────────────────────────────

interface ModEditorProps {
  initialState?: Partial<ModFormState>
  isEdit?: boolean
  /** Jam naddr from the submit flow (?jam=…): forces the "for a mod jam" section on. */
  prefillJam?: string
  onPublish: (form: ModFormState) => Promise<void>
  publishing?: boolean
}

// ─── Section wrapper ────────────────────────────────────────────────

// Mod submission is a 5-step wizard. Sections tag themselves with a `step` and
// `order`; the container is flexbox so only the active step shows and sections
// sort into the intended sequence without reordering the JSX.
const TOTAL_STEPS = 5
const STEP_LABELS = ['Game', 'Details', 'Media', 'Permissions', 'Downloads']
const StepContext = createContext(0)

// Which wizard step each required-field validation error belongs to (for tab dots).
const ERROR_STEP: Partial<Record<keyof FormErrors, number>> = {
  game: 1,
  title: 2, summary: 2, content: 2, tags: 2, originalAuthor: 2,
  featuredImageUrl: 3, screenshots: 3,
  downloads: 5,
}

function Section({
  icon: Icon,
  label,
  children,
  error,
  required,
  incomplete,
  step,
  order,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  children: React.ReactNode
  error?: string
  required?: boolean
  incomplete?: boolean
  step?: number
  order?: number
}) {
  const activeStep = useContext(StepContext)
  const hidden = step !== undefined && activeStep !== 0 && activeStep !== step
  return (
    <div
      className={cn('rounded-xl border border-[#262626] bg-[#1c1c1c]', hidden && 'hidden')}
      style={order !== undefined ? { order } : undefined}
    >
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-[#262626]">
        <Icon size={16} className="text-purple-400 shrink-0" />
        <span className="text-sm font-medium text-neutral-200">{label}</span>
        {required && (
          <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-purple-300">
            Required
          </span>
        )}
        {incomplete && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-label="This required field is still empty" />
        )}
      </div>
      <div className="px-5 py-4 space-y-3">
        {children}
        {error && (
          <p className="text-xs text-red-400 mt-1">{error}</p>
        )}
      </div>
    </div>
  )
}

// ─── Permission row ─────────────────────────────────────────────────

function PermissionRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-neutral-200 group-hover:text-white transition-colors">
          {label}
        </p>
        <p className="text-xs text-neutral-500">{description}</p>
      </div>
    </label>
  )
}

export function ModEditor({
  initialState,
  isEdit = false,
  prefillJam,
  onPublish,
  publishing = false,
}: ModEditorProps) {
  const [form, setForm] = useState<ModFormState>(() => {
    const base = createEmptyFormState()
    return { ...base, ...initialState, isEdit }
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [step, setStep] = useState(1)
  const [showResetDialog, setShowResetDialog] = useState(false)
  const draftRestoredRef = useRef(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const tagInputsRef = useRef<(HTMLInputElement | null)[]>([])

  // Snapshot of the published values, to enable the Update button only on change.
  const publishedFormRef = useRef(form)
  const isDirty = useMemo(() => {
    const normalize = (f: ModFormState) =>
      JSON.stringify({ ...f, isEdit: false, previousCreatedAt: undefined, publishedAt: undefined })
    return normalize(form) !== normalize(publishedFormRef.current)
  }, [form])

  // Live validation drives the publish button (disabled until every required
  // field is satisfied). The `errors` state below is only for showing messages
  // after a submit attempt.
  const liveErrors = useMemo(() => validateModForm(form), [form])
  const isValid = !hasErrors(liveErrors)
  const stepsWithErrors = useMemo(() => {
    const s = new Set<number>()
    for (const key of Object.keys(liveErrors) as (keyof FormErrors)[]) s.add(ERROR_STEP[key] ?? TOTAL_STEPS)
    return s
  }, [liveErrors])


  // ─── Draft persistence ──────────────────────────────────────────
  // Stable key so a draft survives navigation / closing the tab.
  const draftKey = isEdit ? `deg-mods-draft-mod-edit-${form.dTag}` : 'deg-mods-draft-mod-new'
  const skipSaveRef = useRef(true)

  // Auto-restore any saved draft on mount (no prompt).
  useEffect(() => {
    if (draftRestoredRef.current) return
    draftRestoredRef.current = true
    try {
      const saved = localStorage.getItem(draftKey)
      // Merge over fresh defaults so drafts saved before newer fields existed
      // (e.g. dependencies/forMod) don't leave those undefined.
      if (saved) setForm({ ...createEmptyFormState(), ...(JSON.parse(saved) as Partial<ModFormState>), isEdit })
    } catch {
      // ignore parse errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Came here from a jam's "Submit a mod" button (?jam=…): force the jam section
  // on with that address, overriding any restored draft. Runs after draft restore.
  useEffect(() => {
    if (!prefillJam) return
    setForm((prev) => ({ ...prev, jamEnabled: true, jamNaddr: prefillJam }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillJam])

  // Auto-save as the user edits (skipping the initial render).
  useEffect(() => {
    if (skipSaveRef.current) { skipSaveRef.current = false; return }
    try {
      localStorage.setItem(draftKey, JSON.stringify(form))
    } catch {
      // quota exceeded: ignore
    }
  }, [form, draftKey])

  // ─── Updaters ───────────────────────────────────────────────────
  const updateField = useCallback(<K extends keyof ModFormState>(
    key: K,
    value: ModFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => {
      if (key in prev) {
        const next = { ...prev }
        delete next[key as keyof FormErrors]
        return next
      }
      return prev
    })
  }, [])

  const updatePermission = useCallback(
    (key: keyof PermissionsData, value: boolean) => {
      setForm((prev) => ({
        ...prev,
        permissions: { ...prev.permissions, [key]: value },
      }))
    },
    [],
  )

  // ─── Tag helpers ────────────────────────────────────────────────
  const updateTag = (index: number, value: string) => {
    const next = [...form.tags]
    next[index] = value.toLowerCase()
    updateField('tags', next)
  }
  const addTag = () => updateField('tags', [...form.tags, ''])
  const removeTag = (index: number) => {
    const next = form.tags.filter((_, i) => i !== index)
    updateField('tags', next.length === 0 ? [''] : next)
  }
  // Enter on a non-empty tag adds a new field and focuses it.
  const handleTagKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (!form.tags[index]?.trim()) return
    const next = [...form.tags, '']
    updateField('tags', next)
    setTimeout(() => tagInputsRef.current[next.length - 1]?.focus(), 0)
  }

  // ─── Category helpers ──────────────────────────────────────────
  // Each category is a chain stored as "a:b:c"; edited as separate level fields.
  const getSegments = (cat: string) => (cat === '' ? [''] : cat.split(':'))
  const updateSegment = (catIndex: number, segIndex: number, value: string) => {
    const segs = getSegments(form.categories[catIndex])
    segs[segIndex] = value.replace(/:/g, '') // colons are implied by the chain
    const next = [...form.categories]
    next[catIndex] = segs.join(':')
    updateField('categories', next)
  }
  const addSegment = (catIndex: number) => {
    const segs = getSegments(form.categories[catIndex])
    if (segs.length >= CATEGORY_MAX_DEPTH) return
    const next = [...form.categories]
    next[catIndex] = [...segs, ''].join(':')
    updateField('categories', next)
  }
  const removeSegment = (catIndex: number, segIndex: number) => {
    const segs = getSegments(form.categories[catIndex]).filter((_, j) => j !== segIndex)
    const next = [...form.categories]
    next[catIndex] = (segs.length ? segs : ['']).join(':')
    updateField('categories', next)
  }
  const addCategory = () => {
    if (form.categories.length >= CATEGORY_MAX_CHAINS) return
    updateField('categories', [...form.categories, ''])
  }
  const removeCategory = (index: number) => {
    updateField('categories', form.categories.filter((_, i) => i !== index))
  }
  // A chain that's a strict prefix of another is redundant; flag it (it's
  // absorbed into the longer chain on publish rather than stored separately).
  const categoryCoverNotes = categoryCovers(form.categories)

  // Parallel-upload toggle is synced with Settings → Network → Posting.
  const parallelUpload = useSettingsStore(s => s.parallelBlossomUpload)
  const setParallelUpload = useSettingsStore(s => s.setParallelBlossomUpload)

  // ─── Admin suggestions (tags / categories) ─────────────────────
  const suggestions = useSubmitSuggestions()
  const suggestedTags = suggestions.tags.filter(t => !form.tags.some(x => x.trim().toLowerCase() === t.toLowerCase()))
  const suggestedCategories = suggestions.categories.filter(c => !form.categories.includes(c))
  const addSuggestedTag = (t: string) => {
    const tag = t.trim().toLowerCase()
    if (!tag || form.tags.some(x => x.trim().toLowerCase() === tag)) return
    const empty = form.tags.findIndex(x => !x.trim())
    updateField('tags', empty >= 0 ? form.tags.map((x, i) => (i === empty ? tag : x)) : [...form.tags, tag])
  }
  const addSuggestedCategory = (chain: string) => {
    if (form.categories.includes(chain) || form.categories.length >= CATEGORY_MAX_CHAINS) return
    const empty = form.categories.findIndex(c => !c.trim())
    updateField('categories', empty >= 0 ? form.categories.map((c, i) => (i === empty ? chain : c)) : [...form.categories, chain])
  }

  // ─── Dependency helpers ────────────────────────────────────────
  const updateDependency = (index: number, key: 'title' | 'value', val: string) => {
    updateField('dependencies', form.dependencies.map((d, i) => (i === index ? { ...d, [key]: val } : d)))
  }
  const addDependency = () => {
    if (form.dependencies.length >= MAX_DEPENDENCIES) return
    updateField('dependencies', [...form.dependencies, { title: '', value: '' }])
  }
  const removeDependency = (index: number) => {
    const next = form.dependencies.filter((_, i) => i !== index)
    updateField('dependencies', next.length ? next : [{ title: '', value: '' }])
  }

  // ─── Download helpers ──────────────────────────────────────────
  const updateDownload = (index: number, patch: Partial<DownloadEntry>) => {
    const next = [...form.downloads]
    next[index] = { ...next[index], ...patch }
    updateField('downloads', next)
  }
  const addDownload = () => {
    if (form.downloads.length >= MAX_DOWNLOADS) { toast.error(`Up to ${MAX_DOWNLOADS} downloads`); return }
    updateField('downloads', [...form.downloads, { file: '' }])
  }
  const removeDownload = (index: number) => {
    const next = form.downloads.filter((_, i) => i !== index)
    updateField('downloads', next.length === 0 ? [{ file: '' }] : next)
  }

  // ─── Submit ─────────────────────────────────────────────────────
  // Reset an in-progress edit back to the currently published mod, discarding
  // the saved draft. publishedFormRef holds the values loaded at mount.
  const handleReset = () => {
    setForm(publishedFormRef.current)
    setErrors({})
    try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
    setShowResetDialog(false)
    toast.success('Changes reset to the published version')
  }

  const handleSubmit = async () => {
    const validationErrors = validateModForm(form)
    if (hasErrors(validationErrors)) {
      setErrors(validationErrors)
      toast.error('Please fix the errors before publishing')
      return
    }
    setErrors({})
    try {
      await onPublish(form)
      // Clear the draft only after a successful publish.
      try {
        localStorage.removeItem(draftKey)
      } catch {
        // ignore
      }
    } catch {
      // Publish failed: the page surfaces the error; keep the draft.
    }
  }

  // ─── Input classes ─────────────────────────────────────────────
  const inputClass =
    'bg-[#212121] border-[#262626] text-neutral-200 placeholder:text-neutral-600 focus-visible:ring-purple-500/40 focus-visible:border-purple-500/50'
  const errorInputClass = 'border-red-500/50 focus-visible:ring-red-500/40'

  return (
    <div className="w-full mx-auto space-y-6 pb-12">
      {/* Step tabs — segmented control; jump to any step freely. A dot marks a
          step that still has an unfilled Required field. */}
      <div className="flex items-center gap-1 rounded-xl bg-[#212121] p-1 shadow-lg shadow-black/20">
        {STEP_LABELS.map((lbl, idx) => {
          const n = idx + 1
          const active = n === step
          const hasErr = stepsWithErrors.has(n)
          return (
            <button
              key={n}
              type="button"
              onClick={() => setStep(n)}
              className={cn(
                'relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors',
                active ? 'bg-purple-600 text-white shadow-sm' : 'text-neutral-400 hover:bg-[#2a2a2a] hover:text-neutral-200',
              )}
            >
              <span className={cn(
                'flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
                active ? 'bg-white/20 text-white' : 'bg-[#2e2e2e] text-neutral-500',
              )}>{n}</span>
              <span className="hidden truncate sm:inline">{lbl}</span>
              {hasErr && (
                <span
                  className={cn(
                    'absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400 ring-2',
                    active ? 'ring-purple-600' : 'ring-[#212121]',
                  )}
                  aria-label="Incomplete required fields"
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Sections — flexbox so `order` sorts within a step and only the active step shows */}
      <StepContext.Provider value={step}>
      <div className="flex flex-col gap-6">
      {/* ── 1. Game ─────────────────────────────────────────────── */}
      <Section icon={Gamepad2} label="Game" error={errors.game} required incomplete={!!liveErrors.game} step={1} order={1}>
        <p className="text-xs text-neutral-500 leading-relaxed">
          Can't find your game? Make sure to write it exactly as it appears on game stores like DEGA, Steam, GOG, Itch, etc.
        </p>
        <GameAutocomplete
          value={form.game}
          onChange={(val) => updateField('game', val)}
          maxLength={LIMITS.game}
          className={cn(inputClass, errors.game && errorInputClass)}
        />
        <Counter value={form.game} max={LIMITS.game} />
      </Section>

      {/* ── 1b. For another mod ─────────────────────────────────── */}
      <Section icon={Layers} label="For another mod" step={1} order={3}>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <Switch
              checked={form.forModEnabled}
              onCheckedChange={(v) => updateField('forModEnabled', v)}
            />
            <span className="text-sm text-neutral-300">This is a mod for another mod</span>
          </label>
          {form.forModEnabled && (
            <>
              <Input
                value={form.forMod}
                onChange={(e) => updateField('forMod', e.target.value)}
                placeholder="Mod name, naddr, or link"
                maxLength={LIMITS.forMod}
                className={inputClass}
              />
              <Counter value={form.forMod} max={LIMITS.forMod} />
              <p className="text-xs text-neutral-500">Typing a name shows as text; pasting a mod post address becomes a “View mod” button to open it on this same platform; adding a link becomes a button that opens it in a new browser tab.</p>
            </>
          )}
        </div>
      </Section>

      {/* ── 1c. For a mod jam ───────────────────────────────────── */}
      <Section icon={JamIcon} label="For a mod jam" step={1} order={4}>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <Switch
              checked={form.jamEnabled}
              onCheckedChange={(v) => updateField('jamEnabled', v)}
            />
            <span className="text-sm text-neutral-300">This mod is an entry for a mod jam</span>
          </label>
          {form.jamEnabled && (
            <>
              <JamSubmissionField
                value={form.jamNaddr}
                onChange={(v) => updateField('jamNaddr', v)}
                inputClass={inputClass}
              />
              <p className="text-xs text-neutral-500">Paste the mod jam’s address (from its page’s share button). Your mod is linked to that jam as a submission. Only mods published during the jam’s window count as valid entries.</p>
            </>
          )}
        </div>
      </Section>

      {/* ── 2. Title ────────────────────────────────────────────── */}
      <Section icon={Type} label="Title" error={errors.title} required incomplete={!!liveErrors.title} step={2} order={4}>
        <Input
          value={form.title}
          onChange={(e) => updateField('title', e.target.value)}
          placeholder="Mod title"
          maxLength={LIMITS.title}
          className={cn(inputClass, errors.title && errorInputClass)}
        />
        <Counter value={form.title} max={LIMITS.title} />
      </Section>

      {/* ── 3. Body (Edit / Preview) ────────────────────────────── */}
      <Section icon={FileText} label="Body" error={errors.content} required incomplete={!!liveErrors.content} step={2} order={6}>
        <Tabs defaultValue="edit" className="w-full">
          <TabsList className="bg-[#212121] border border-[#262626]">
            <TabsTrigger value="edit" className="gap-1.5 text-xs data-[state=active]:bg-[#2a2a2a]">
              <Pencil size={13} /> Edit
            </TabsTrigger>
            <TabsTrigger value="preview" className="gap-1.5 text-xs data-[state=active]:bg-[#2a2a2a]">
              <Eye size={13} /> Preview
            </TabsTrigger>
          </TabsList>
          <TabsContent value="edit" className="mt-3 space-y-2">
            <MarkdownToolbar
              textareaRef={bodyRef}
              value={form.content}
              onChange={(val) => updateField('content', val)}
            />
            <Textarea
              ref={bodyRef}
              value={form.content}
              onChange={(e) => updateField('content', e.target.value)}
              placeholder="Write your mod description in markdown..."
              rows={10}
              maxLength={LIMITS.content}
              className={cn(inputClass, 'min-h-[240px] resize-y', errors.content && errorInputClass)}
            />
            <Counter value={form.content} max={LIMITS.content} />
          </TabsContent>
          <TabsContent value="preview" className="mt-3">
            <div className="rounded-lg border border-[#262626] bg-[#212121] p-4 min-h-[240px]">
              {form.content.trim() ? (
                <Markdown content={form.content} />
              ) : (
                <span className="text-neutral-600 italic text-sm">Nothing to preview</span>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Section>

      {/* ── 4. Featured Image ───────────────────────────────────── */}
      <Section icon={ImageIcon} label="Featured Image" error={errors.featuredImageUrl} required incomplete={!!liveErrors.featuredImageUrl} step={3} order={11}>
        <div className="space-y-3">
          <Input
            value={form.featuredImageUrl}
            onChange={(e) => updateField('featuredImageUrl', e.target.value)}
            placeholder="Image URL (https://...)"
            maxLength={LIMITS.featuredImage}
            className={cn(inputClass, errors.featuredImageUrl && errorInputClass)}
          />
          <Counter value={form.featuredImageUrl} max={LIMITS.featuredImage} />
          <div className="flex items-center gap-3">
            <Separator className="flex-1 bg-[#262626]" />
            <span className="text-xs text-neutral-600 uppercase tracking-wider">or upload</span>
            <Separator className="flex-1 bg-[#262626]" />
          </div>
          <BlossomUploadField
            accept={IMAGE_UPLOAD_ACCEPT}
            label="Drop image here or click to browse"
            sublabel="JPG, PNG, WebP, GIF, AVIF · mirrored to up to 3 servers"
            onUploaded={(r) => updateField('featuredImageUrl', r.url)}
          />
          {form.featuredImageUrl && (
            <div className="rounded-lg border border-[#262626] overflow-hidden">
              <img
                src={form.featuredImageUrl}
                alt="Featured preview"
                className="w-full max-h-64 object-cover"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
          )}
        </div>
      </Section>

      {/* ── 5. Featured Video ───────────────────────────────────── */}
      <Section icon={Video} label="Featured Video" step={3} order={12}>
        <Input
          value={form.featuredVideoUrl}
          onChange={(e) => updateField('featuredVideoUrl', e.target.value)}
          placeholder="Video URL (optional)"
          maxLength={LIMITS.featuredVideo}
          className={inputClass}
        />
        <Counter value={form.featuredVideoUrl} max={LIMITS.featuredVideo} />
      </Section>

      {/* ── 6. Summary ──────────────────────────────────────────── */}
      <Section icon={FileText} label="Summary" error={errors.summary} required incomplete={!!liveErrors.summary} step={2} order={5}>
        <Textarea
          value={form.summary}
          onChange={(e) => updateField('summary', e.target.value)}
          placeholder="Brief summary of your mod..."
          rows={3}
          maxLength={LIMITS.summary}
          className={cn(inputClass, 'resize-y', errors.summary && errorInputClass)}
        />
        <Counter value={form.summary} max={LIMITS.summary} />
      </Section>

      {/* ── 7. Content Warning ──────────────────────────────────── */}
      <Section icon={AlertTriangle} label="Content Warning" step={2} order={7}>
        <label className="flex items-center gap-3 cursor-pointer">
          <Switch
            checked={form.contentWarning}
            onCheckedChange={(v) => updateField('contentWarning', v)}
          />
          <span className="text-sm text-neutral-300">This mod contains sensitive content (NSFW)</span>
        </label>
      </Section>

      {/* ── 8. Repost ───────────────────────────────────────────── */}
      <Section icon={Repeat2} label="Repost" error={errors.originalAuthor} required={form.isRepost} incomplete={!!liveErrors.originalAuthor} step={2} order={8}>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <Switch
              checked={form.isRepost}
              onCheckedChange={(v) => updateField('isRepost', v)}
            />
            <span className="text-sm text-neutral-300">This is a repost of someone else's mod</span>
          </label>
          {form.isRepost && (
            <>
              <Input
                value={form.originalAuthor}
                onChange={(e) => updateField('originalAuthor', e.target.value)}
                placeholder="Original author npub, link, or name"
                maxLength={LIMITS.originalAuthor}
                className={cn(inputClass, errors.originalAuthor && errorInputClass)}
              />
              <Counter value={form.originalAuthor} max={LIMITS.originalAuthor} />
            </>
          )}
        </div>
      </Section>

      {/* ── 8b. Emulation ───────────────────────────────────────── */}
      <Section icon={Joystick} label="Emulation" step={1} order={2}>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <Switch
              checked={form.emulation}
              onCheckedChange={(v) => updateField('emulation', v)}
            />
            <span className="text-sm text-neutral-300">This is for an emulated game</span>
          </label>
          {form.emulation && (
            <>
              <EmulatedPlatformField
                value={form.emulatedPlatform}
                onChange={(v) => updateField('emulatedPlatform', v)}
                maxLength={LIMITS.emulatedPlatform}
                className={inputClass}
              />
              <Counter value={form.emulatedPlatform} max={LIMITS.emulatedPlatform} />
            </>
          )}
        </div>
      </Section>

      {/* ── 9. Screenshots ──────────────────────────────────────── */}
      <Section icon={ImageIcon} label="Screenshots" error={errors.screenshots} required incomplete={!!liveErrors.screenshots} step={3} order={13}>
        <ScreenshotsEditor
          urls={form.screenshots}
          onChange={(urls) => updateField('screenshots', urls)}
          max={MAX_SCREENSHOTS}
          maxUrlLength={LIMITS.screenshot}
          inputClass={inputClass}
        />
      </Section>

      {/* ── 10. Tags ────────────────────────────────────────────── */}
      <Section icon={Tag} label="Tags" error={errors.tags} required incomplete={!!liveErrors.tags} step={2} order={9}>
        <div className="space-y-2">
          {form.tags.map((tag, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <Input
                  ref={(el) => { tagInputsRef.current[i] = el }}
                  value={tag}
                  onChange={(e) => updateTag(i, e.target.value)}
                  onKeyDown={(e) => handleTagKeyDown(e, i)}
                  placeholder={`Tag #${i + 1}`}
                  maxLength={LIMITS.tag}
                  className={cn(inputClass, 'flex-1')}
                />
                <button
                  type="button"
                  onClick={() => removeTag(i)}
                  className="text-neutral-500 hover:text-neutral-300 transition-colors p-1.5 rounded hover:bg-[#2a2a2a] cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
              <Counter value={tag} max={LIMITS.tag} />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addTag}
            className="text-xs border-[#262626] bg-transparent hover:bg-[#2a2a2a] text-neutral-400"
          >
            <Plus size={14} className="mr-1" /> Add Tag
          </Button>
          {suggestedTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-neutral-500">Suggested:</span>
              {suggestedTags.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addSuggestedTag(t)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#262626] bg-[#212121] px-2 py-1 text-xs text-neutral-300 transition-colors hover:border-purple-500/40 hover:text-purple-300"
                >
                  <Plus size={11} /> {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-neutral-600">Tags are automatically lowercased. Press Enter to add another.</p>
      </Section>

      {/* ── 11. Downloads ───────────────────────────────────────── */}
      <Section icon={Download} label="Downloads" error={errors.downloads} required incomplete={!!liveErrors.downloads} step={5} order={17}>
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-[#262626] bg-[#171717] p-3 cursor-pointer">
            <div className="min-w-0">
              <p className="text-sm text-neutral-200">Upload to blossom servers in parallel</p>
              <p className="text-xs text-neutral-500">Up to 3 at once instead of one at a time — faster for large files. Synced with Settings → Network → Posting.</p>
            </div>
            <Switch checked={parallelUpload} onCheckedChange={setParallelUpload} className="shrink-0" />
          </label>
          {form.downloads.map((dl, i) => {
            const urlHash = hashFromUrl(dl.file)
            const hashLocked = !!urlHash          // hash comes from the file link → not editable
            const fileEmpty = !dl.file.trim()
            return (
            <div
              key={i}
              className="rounded-lg border border-[#262626] bg-[#171717] p-4 space-y-3"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-neutral-400">
                  Download #{i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeDownload(i)}
                  className="text-neutral-500 hover:text-red-400 transition-colors p-1 rounded hover:bg-[#2a2a2a] cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
              <div>
                <Input
                  value={dl.file}
                  onChange={(e) => {
                    const val = e.target.value
                    const h = hashFromUrl(val)
                    // A manually-typed/pasted link has no known original name; drop it.
                    const patch: Partial<DownloadEntry> = { file: val, filename: undefined }
                    if (h) patch.hash = h                              // link carries the hash → lock to it
                    else if (dl.hash && dl.hash === urlHash) patch.hash = undefined // clear a previously auto-derived hash
                    updateDownload(i, patch)
                  }}
                  placeholder="File URL (required)"
                  maxLength={LIMITS.downloadUrl}
                  className={inputClass}
                />
                <Counter value={dl.file} max={LIMITS.downloadUrl} />
              </div>
              <BlossomUploadField
                accept={MOD_FILE_UPLOAD_ACCEPT}
                maxSizeMb={MOD_FILE_UPLOAD_LIMIT_MB}
                label="Or upload file (mirrored to up to 3 servers)"
                sublabel={`.ZIP only · max ${MOD_FILE_UPLOAD_LIMIT_MB} MB`}
                onUploaded={(r) => updateDownload(i, { file: r.url, hash: r.hash, filename: r.filename })}
              />

              {/* Smart hash field: auto-filled + locked from an upload or a hash link,
                  editable for a plain link, disabled with no file. */}
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[11px] font-medium text-neutral-400">SHA-256 hash</span>
                  {hashLocked && <span className="text-[10px] text-emerald-400/80">auto-detected from link</span>}
                </div>
                <Input
                  value={hashLocked ? urlHash! : (dl.hash || '')}
                  onChange={(e) => updateDownload(i, { hash: e.target.value.trim().toLowerCase() })}
                  placeholder={fileEmpty ? 'Add a file or link first' : 'Optional — the file’s SHA-256'}
                  maxLength={64}
                  readOnly={hashLocked}
                  disabled={fileEmpty}
                  className={cn(inputClass, 'font-mono text-xs', (hashLocked || fileEmpty) && 'opacity-60')}
                />
                {hashLocked ? (
                  <p className="mt-1 text-[10px] text-neutral-600">Taken from the hash in the file link — can't be edited.</p>
                ) : !fileEmpty ? (
                  <Counter value={dl.hash || ''} max={64} />
                ) : null}
              </div>

              {dl.filename && (
                <p className="text-[11px] text-neutral-500">
                  Downloads as <span className="font-mono text-neutral-300">{dl.filename}</span>
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Input
                    value={dl.title || ''}
                    onChange={(e) => updateDownload(i, { title: e.target.value })}
                    placeholder="Title (optional)"
                    maxLength={LIMITS.downloadTitle}
                    className={inputClass}
                  />
                  <Counter value={dl.title || ''} max={LIMITS.downloadTitle} />
                </div>
                <div>
                  <Input
                    value={dl.version || ''}
                    onChange={(e) => updateDownload(i, { version: e.target.value })}
                    placeholder="Version (optional)"
                    maxLength={LIMITS.downloadVersion}
                    className={inputClass}
                  />
                  <Counter value={dl.version || ''} max={LIMITS.downloadVersion} />
                </div>
              </div>
              <div>
                <Input
                  value={dl.note || ''}
                  onChange={(e) => updateDownload(i, { note: e.target.value })}
                  placeholder="Note (optional)"
                  maxLength={LIMITS.downloadNote}
                  className={inputClass}
                />
                <Counter value={dl.note || ''} max={LIMITS.downloadNote} />
              </div>
              <div>
                <Input
                  value={dl.image || ''}
                  onChange={(e) => updateDownload(i, { image: e.target.value })}
                  placeholder="Preview image URL (optional)"
                  maxLength={LIMITS.downloadUrl}
                  className={inputClass}
                />
                <Counter value={dl.image || ''} max={LIMITS.downloadUrl} />
              </div>
              <DownloadScanReports dl={dl} onChange={(patch) => updateDownload(i, patch)} />
            </div>
            )
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addDownload}
            disabled={form.downloads.length >= MAX_DOWNLOADS}
            className="text-xs border-[#262626] bg-transparent hover:bg-[#2a2a2a] text-neutral-400"
          >
            <Plus size={14} className="mr-1" /> Add Download
          </Button>
          <span className="ml-2 text-[10px] text-neutral-600">{form.downloads.length}/{MAX_DOWNLOADS}</span>
        </div>
      </Section>

      {/* ── 11b. Dependencies ───────────────────────────────────── */}
      <Section icon={Boxes} label="Dependencies" step={5} order={18}>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <Switch
              checked={form.dependenciesEnabled}
              onCheckedChange={(v) => updateField('dependenciesEnabled', v)}
            />
            <span className="text-sm text-neutral-300">This mod depends on other mods, software, or files</span>
          </label>
          {form.dependenciesEnabled && (
            <div className="space-y-2">
              {form.dependencies.map((dep, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-40 shrink-0">
                    <Input
                      value={dep.title}
                      onChange={(e) => updateDependency(i, 'title', e.target.value)}
                      placeholder="Title"
                      maxLength={LIMITS.dependencyTitle}
                      className={inputClass}
                    />
                    <Counter value={dep.title} max={LIMITS.dependencyTitle} />
                  </div>
                  <div className="flex-1">
                    <Input
                      value={dep.value}
                      onChange={(e) => updateDependency(i, 'value', e.target.value)}
                      placeholder="Mod name, naddr, or link"
                      maxLength={LIMITS.dependencyValue}
                      className={inputClass}
                    />
                    <Counter value={dep.value} max={LIMITS.dependencyValue} />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeDependency(i)}
                    className="shrink-0 rounded p-2 text-neutral-500 transition-colors hover:bg-[#2a2a2a] hover:text-red-400"
                    aria-label="Remove dependency"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <div className="flex items-center">
                {form.dependencies.length < MAX_DEPENDENCIES && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addDependency}
                    className="text-xs border-[#262626] bg-transparent hover:bg-[#2a2a2a] text-neutral-400"
                  >
                    <Plus size={14} className="mr-1" /> Add dependency
                  </Button>
                )}
                <span className="ml-2 text-[10px] text-neutral-600">{form.dependencies.length}/{MAX_DEPENDENCIES}</span>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── 12. Permissions ─────────────────────────────────────── */}
      <Section icon={Shield} label="Permissions" step={4} order={14}>
        <div className="space-y-4">
          <PermissionRow
            label="Original Assets"
            description="All assets are owned or from free resources"
            checked={form.permissions.originalAssets}
            onCheckedChange={(v) => updatePermission('originalAssets', v)}
          />
          <PermissionRow
            label="Reupload"
            description="Others may upload to other sites with credit"
            checked={form.permissions.reupload}
            onCheckedChange={(v) => updatePermission('reupload', v)}
          />
          <PermissionRow
            label="Modification"
            description="Others may modify and release fixes with credit"
            checked={form.permissions.modification}
            onCheckedChange={(v) => updatePermission('modification', v)}
          />
          <PermissionRow
            label="Conversion"
            description="Others may convert for other games with credit"
            checked={form.permissions.conversion}
            onCheckedChange={(v) => updatePermission('conversion', v)}
          />
          <PermissionRow
            label="Asset Usage"
            description="Others may use assets with credit"
            checked={form.permissions.assetUsage}
            onCheckedChange={(v) => updatePermission('assetUsage', v)}
          />
          <PermissionRow
            label="Commercial"
            description="Others may use in commercial/paid mods"
            checked={form.permissions.commercial}
            onCheckedChange={(v) => updatePermission('commercial', v)}
          />
        </div>
      </Section>

      {/* ── 13. Publisher Notes ──────────────────────────────────── */}
      <Section icon={StickyNote} label="Publisher Notes" step={4} order={15}>
        <Textarea
          value={form.notes}
          onChange={(e) => updateField('notes', e.target.value)}
          placeholder="Notes for other publishers or moderators (optional)"
          rows={3}
          maxLength={LIMITS.note}
          className={cn(inputClass, 'resize-y')}
        />
        <Counter value={form.notes} max={LIMITS.note} />
      </Section>

      {/* ── 14. Credits ─────────────────────────────────────────── */}
      <Section icon={Users} label="Credits" step={4} order={16}>
        <Textarea
          value={form.credits}
          onChange={(e) => updateField('credits', e.target.value)}
          placeholder="Credit authors, tools, resources used (optional)"
          rows={3}
          maxLength={LIMITS.credits}
          className={cn(inputClass, 'resize-y')}
        />
        <Counter value={form.credits} max={LIMITS.credits} />
      </Section>

      {/* ── 15. Categories ──────────────────────────────────────── */}
      <Section icon={FolderTree} label="Categories" step={2} order={10}>
        <div className="space-y-3">
          {form.categories.map((cat, i) => {
            const segments = getSegments(cat)
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
                            onChange={(e) => updateSegment(i, j, e.target.value)}
                            placeholder={j === 0 ? 'Category' : 'Subcategory'}
                            maxLength={LIMITS.category}
                            className={cn(inputClass, 'w-36 border-0 bg-transparent focus-visible:ring-0')}
                          />
                          {segments.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeSegment(i, j)}
                              className="shrink-0 p-1 text-neutral-500 hover:text-red-400"
                              aria-label="Remove level"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {segments.length < CATEGORY_MAX_DEPTH && (
                      <button
                        type="button"
                        onClick={() => addSegment(i)}
                        className="inline-flex items-center gap-1 rounded-md border border-dashed border-[#333] px-2 py-1.5 text-xs text-neutral-400 transition-colors hover:border-[#444] hover:text-neutral-200"
                      >
                        <Plus size={12} /> level
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCategory(i)}
                    className="shrink-0 rounded p-1.5 text-neutral-500 transition-colors hover:bg-[#2a2a2a] hover:text-red-400"
                    aria-label="Remove category"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {categoryCoverNotes[i] && (
                  <p className="mt-2 text-xs text-amber-500/90">{categoryCoverNotes[i]}</p>
                )}
              </div>
            )
          })}
          {form.categories.length < CATEGORY_MAX_CHAINS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addCategory}
              className="text-xs border-[#262626] bg-transparent hover:bg-[#2a2a2a] text-neutral-400"
            >
              <Plus size={14} className="mr-1" /> Add Category
            </Button>
          )}
          {suggestedCategories.length > 0 && form.categories.length < CATEGORY_MAX_CHAINS && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-neutral-500">Suggested:</span>
              {suggestedCategories.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => addSuggestedCategory(c)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#262626] bg-[#212121] px-2 py-1 text-xs text-neutral-300 transition-colors hover:border-purple-500/40 hover:text-purple-300"
                >
                  <Plus size={11} /> {c.split(':').filter(Boolean).join(' › ')}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-neutral-600">
          Each category is a chain (e.g. type › texture › hd). Add up to {CATEGORY_MAX_DEPTH} levels, {LIMITS.category} chars each.
        </p>
      </Section>

      </div>
      </StepContext.Provider>

      {/* Prev / Next — Previous disabled on step 1, Next disabled on the last step */}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={step === 1}
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          className="gap-1.5 border-[#262626] bg-transparent text-neutral-300 hover:bg-[#2a2a2a] disabled:opacity-40"
        >
          <ChevronLeft size={16} /> Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={step === TOTAL_STEPS}
          onClick={() => setStep((s) => Math.min(TOTAL_STEPS, s + 1))}
          className="gap-1.5 border-[#262626] bg-transparent text-neutral-300 hover:bg-[#2a2a2a] disabled:opacity-40"
        >
          Next <ChevronRight size={16} />
        </Button>
      </div>

      {/* Publish/update actions: editing an existing mod shows them on every step
          (you can update from anywhere); a new mod only publishes from the last step. */}
      {(isEdit || step === TOTAL_STEPS) && (
      <>
      <div className="flex gap-3">
        {/* Reset (edit mode): discard draft edits, restore the published values. */}
        {isEdit && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowResetDialog(true)}
            disabled={publishing || !isDirty}
            className="h-12 px-6 rounded-xl border-[#262626] bg-transparent text-neutral-300 hover:bg-[#2a2a2a] disabled:opacity-50"
          >
            <RotateCcw size={15} className="mr-2" /> Reset changes
          </Button>
        )}
        <Button
          onClick={handleSubmit}
          disabled={publishing || !isValid || (isEdit && !isDirty)}
          className={cn(
            'flex-1 h-12 text-sm font-semibold rounded-xl transition-colors',
            'bg-purple-600 hover:bg-purple-700 text-white',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {publishing ? (
            <span className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              {isEdit ? 'Updating...' : 'Publishing...'}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Upload size={16} />
              {isEdit ? 'Update Mod' : 'Publish Mod'}
            </span>
          )}
        </Button>
      </div>

      {!isValid && !publishing && (
        <p className="text-center text-xs text-neutral-500">
          Fill in all <span className="text-purple-300">Required</span> fields to {isEdit ? 'update' : 'publish'}.
        </p>
      )}
      </>
      )}

      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Reset changes?</DialogTitle>
            <DialogDescription className="text-neutral-400">
              This discards your unsaved edits (including the locally saved draft) and restores every field to the currently published version of this mod. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetDialog(false)} className="border-[#262626]">Cancel</Button>
            <Button onClick={handleReset} className="bg-red-600 hover:bg-red-700 text-white">Reset to published</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
