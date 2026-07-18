import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Plus, X, Info, Loader2, Pencil, Eye, RotateCcw, Lock, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { BlossomUploadField } from '@/components/upload/BlossomUploadField'
import { GameAutocomplete } from '@/components/shared/GameAutocomplete'
import { ScreenshotsEditor } from '@/components/shared/ScreenshotsEditor'
import { JudgeList } from './JudgeList'
import { MarkdownToolbar } from '@/components/shared/MarkdownToolbar'
import { Markdown } from '@/components/shared/Markdown'
import { CharCounter } from '@/components/shared/CharCounter'
import { useNow } from '@/hooks/useNow'
import { DatePicker } from './DatePicker'
import { TimePicker, browserUses12h } from './TimePicker'
import { IMAGE_UPLOAD_ACCEPT } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settingsStore'
import { probeCountSupport, cachedCountSupport, type CountSupport } from '@/lib/nostr/relayCapabilities'
import { localToUnix, unixToLocal, MOD_JAM_TYPE, type JamFormState, type JamReward, type JamCriterion, type JamFaq, type JamRule, type JamDetails } from '@/lib/nostr/jam'
import { cn } from '@/lib/utils'

// ─── Character limits ───────────────────────────────────────────────
const LIMITS = {
  title: 150,
  theme: 200,
  summary: 300,
  content: 30000,
  imageUrl: 200,
  videoUrl: 200,
  screenshotUrl: 200,
  game: 100,
  tag: 100,
  judge: 150,
  criterion: 40,
  rewardCurrency: 24,
  rewardAmount: 50,
  rewardText: 150,
  rewardNote: 1000,
  relay: 200,
  faqQuestion: 200,
  faqAnswer: 1000,
  ruleTitle: 200,
  ruleDetail: 1000,
} as const

const Counter = CharCounter

// How many of each list a jam may have.
const MAX = {
  screenshots: 15,
  games: 10,
  tags: 20,
  judges: 25,
  rewards: 20,
  faq: 30,
  rules: 30,
  criteria: 15,
} as const

/**
 * A ready-made criteria set for creators who don't want to invent one. Kept
 * short and generic on purpose — these are the axes most mod jams end up
 * scoring anyway, and a creator can edit any of them after filling.
 */
const CRITERIA_TEMPLATE = ['Gameplay', 'Creativity', 'Theme fit', 'Visuals', 'Audio', 'Polish']

/**
 * Treat a deadline as reached slightly early when deciding what may still be
 * edited. Our clock governs the lock while each voter's clock stamps their
 * ballot, so without a margin a slow clock here could let criteria move under
 * ballots that already count. Nobody legitimately needs to retune a jam in the
 * last minute before its deadline.
 */
const LOCK_MARGIN_SECONDS = 60

/** A small "N/max" item-count badge (amber once the cap is hit). */
const CountBadge = ({ n, max }: { n: number; max: number }) => (
  <span className={cn('text-[10px] tabular-nums', n >= max ? 'text-amber-400' : 'text-neutral-600')}>{n}/{max}</span>
)

/** One vote relay row: enabled toggle + url + remove. */
interface VoteRelay { url: string; enabled: boolean }

interface EditorState {
  title: string
  image: string
  video: string
  summary: string
  theme: string
  content: string
  contentWarning: boolean
  screenshots: string[]
  games: string[]
  tags: string[]
  startDate: string; startTime: string
  endDate: string; endTime: string
  votingEnabled: boolean
  userVotingEnabled: boolean
  judges: string[]
  votingEndDate: string; votingEndTime: string
  customCriteria: boolean
  criteria: string[] // labels only — every criterion shares scoreMax
  scoreMax: number
  rewards: JamReward[]
  rewardNote: string
  relays: VoteRelay[]
  faq: JamFaq[]
  rules: JamRule[]
}

/** Randomly pick up to `n` items (Fisher–Yates on a copy). */
function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

/**
 * Seed the vote relays: up to 3 random from the client relay list + up to 3
 * random from the user's own relay list, all enabled. This is also what "reset
 * to defaults" re-rolls.
 */
function defaultVoteRelays(): VoteRelay[] {
  const s = useSettingsStore.getState()
  const client = sample(s.clientRelays.map((r) => r.url), 3)
  const user = sample(s.userRelays.map((r) => r.url), 3)
  const urls = [...new Set([...client, ...user])]
  return urls.map((url) => ({ url, enabled: true }))
}

function emptyState(): EditorState {
  return {
    title: '', image: '', video: '', summary: '', theme: '', content: '',
    contentWarning: false,
    screenshots: [], games: [], tags: [],
    startDate: '', startTime: '', endDate: '', endTime: '',
    votingEnabled: false, userVotingEnabled: false, judges: [],
    votingEndDate: '', votingEndTime: '',
    customCriteria: false, criteria: ['', ''], scoreMax: 10,
    rewards: [], rewardNote: '', relays: defaultVoteRelays(), faq: [], rules: [],
  }
}

/** Prefill the editor from an existing jam (edit flow). */
function stateFromJam(jam: JamDetails): EditorState {
  const start = unixToLocal(jam.start), end = unixToLocal(jam.end)
  const ve = jam.votingEnd ? unixToLocal(jam.votingEnd) : { date: '', time: '' }
  return {
    title: jam.title, image: jam.image, video: jam.video, summary: jam.summary, theme: jam.theme, content: jam.content,
    contentWarning: !!jam.contentWarning,
    screenshots: [...jam.screenshots], games: [...jam.games], tags: [...jam.tags],
    startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time,
    votingEnabled: jam.votingEnabled, userVotingEnabled: jam.userVotingEnabled, judges: [...jam.judges],
    votingEndDate: ve.date, votingEndTime: ve.time,
    customCriteria: jam.criteria.length > 0,
    criteria: jam.criteria.length ? jam.criteria.map((c) => c.label) : ['', ''],
    scoreMax: jam.scoreMax || 10,
    rewards: jam.rewards.map((r) => ({ ...r })), rewardNote: jam.rewardNote,
    relays: jam.relays.map((url) => ({ url, enabled: true })), faq: jam.faq.map((f) => ({ ...f })), rules: jam.rules.map((r) => ({ ...r })),
  }
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-xl border border-[#262626] bg-[#1c1c1c] p-4">
    <h2 className="text-sm font-semibold text-white">{title}</h2>
    {children}
  </section>
)

const Label = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <label className="text-xs font-medium text-neutral-400">{children}{hint && <span className="ml-1 text-neutral-600">{hint}</span>}</label>
)

const inputCls = 'border-[#262626] bg-[#212121] text-white placeholder:text-neutral-500'

/** A chip-list input (tags): type + Enter to add, click × to remove. */
function ChipInput({ items, onChange, placeholder, transform, maxLength, max }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; transform?: (s: string) => string; maxLength?: number; max?: number }) {
  const [val, setVal] = useState('')
  const full = max !== undefined && items.length >= max
  const add = () => {
    if (full) return
    const v = (transform ? transform(val) : val).trim()
    if (v && !items.includes(v)) onChange([...items, v])
    setVal('')
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} placeholder={placeholder} maxLength={maxLength} disabled={full} className={inputCls} />
        <Button type="button" variant="outline" className="shrink-0 border-[#262626]" onClick={add} disabled={full}><Plus className="h-4 w-4" /></Button>
      </div>
      <div className="flex items-center justify-end gap-3">
        {maxLength && <Counter value={val} max={maxLength} />}
        {max !== undefined && <CountBadge n={items.length} max={max} />}
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <span key={it} className="inline-flex items-center gap-1 rounded-md bg-[#262626] px-2 py-0.5 text-xs text-neutral-200">
              {it}
              <button type="button" onClick={() => onChange(items.filter((x) => x !== it))} className="text-neutral-500 hover:text-red-400"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Games chip input with games-DB autocomplete on the entry field. */
function GameChipInput({ games, onChange, maxLength, max }: { games: string[]; onChange: (v: string[]) => void; maxLength?: number; max?: number }) {
  const [val, setVal] = useState('')
  const full = max !== undefined && games.length >= max
  const add = (game?: string) => {
    if (full) return
    const v = (game ?? val).trim()
    if (v && !games.includes(v)) onChange([...games, v])
    setVal('')
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-1" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}>
          <GameAutocomplete value={val} onChange={setVal} onSelect={(g) => add(g)} maxLength={maxLength} placeholder="Add a game and press Enter" className={inputCls} disabled={full} />
        </div>
        <Button type="button" variant="outline" className="shrink-0 border-[#262626]" onClick={() => add()} disabled={full}><Plus className="h-4 w-4" /></Button>
      </div>
      <div className="flex items-center justify-end gap-3">
        {maxLength && <Counter value={val} max={maxLength} />}
        {max !== undefined && <CountBadge n={games.length} max={max} />}
      </div>
      {games.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {games.map((it) => (
            <span key={it} className="inline-flex items-center gap-1 rounded-md bg-[#262626] px-2 py-0.5 text-xs text-neutral-200">
              {it}
              <button type="button" onClick={() => onChange(games.filter((x) => x !== it))} className="text-neutral-500 hover:text-red-400"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A relay's NIP-45 badge. Counting is how community votes get tallied at scale,
 * so whether a relay supports it is worth knowing while you're picking relays
 * rather than after the jam has run.
 */
function CountBadgeForRelay({ state }: { state: CountSupport }) {
  const style: Record<string, { text: string; cls: string; tip: string }> = {
    checking: { text: 'checking…', cls: 'border-[#333] text-neutral-500', tip: 'Asking this relay whether it supports counting.' },
    yes: { text: 'counts', cls: 'border-emerald-500/40 text-emerald-400', tip: 'Supports NIP-45 — community votes here can be tallied by counting.' },
    no: { text: 'no count', cls: 'border-amber-500/40 text-amber-400', tip: "Reachable, but doesn't support NIP-45 counting. Ballots still publish here." },
    unreachable: { text: 'unreachable', cls: 'border-red-500/40 text-red-400', tip: "Couldn't connect to this relay." },
    unknown: { text: 'checking…', cls: 'border-[#333] text-neutral-500', tip: '' },
  }
  const s = style[state] ?? style.unknown

  return (
    <span title={s.tip} className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium', s.cls)}>
      {s.text}
    </span>
  )
}

/** Vote-relay list: each relay is a full-width row with an enable toggle + remove. */
function VoteRelayList({ relays, onChange, appendOnly, support }: { relays: VoteRelay[]; onChange: (v: VoteRelay[]) => void; appendOnly?: boolean; support: Record<string, CountSupport> }) {
  const [val, setVal] = useState('')
  const add = () => {
    const u = val.trim()
    if (u && !relays.some((r) => r.url === u)) onChange([...relays, { url: u, enabled: true }])
    setVal('')
  }
  const toggle = (url: string) => onChange(relays.map((r) => r.url === url ? { ...r, enabled: !r.enabled } : r))
  const remove = (url: string) => onChange(relays.filter((r) => r.url !== url))

  return (
    <div className="space-y-2">
      {relays.length > 0 && (
        <div className="space-y-1.5">
          {relays.map((r) => (
            <div key={r.url} className="flex items-center gap-3 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2">
              <Switch checked={r.enabled} onCheckedChange={() => toggle(r.url)} disabled={appendOnly} />
              <span className={cn('min-w-0 flex-1 truncate font-mono text-xs', r.enabled ? 'text-neutral-200' : 'text-neutral-500 line-through')}>{r.url}</span>
              <CountBadgeForRelay state={support[r.url] ?? 'unknown'} />
              {!appendOnly && <button type="button" onClick={() => remove(r.url)} className="shrink-0 text-neutral-500 hover:text-red-400"><X className="h-4 w-4" /></button>}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} placeholder="wss://…" maxLength={LIMITS.relay} className={`${inputCls} font-mono text-xs`} />
        <Button type="button" variant="outline" className="shrink-0 border-[#262626]" onClick={add}><Plus className="h-4 w-4" /></Button>
      </div>
      <div className="flex justify-end"><Counter value={val} max={LIMITS.relay} /></div>
      {!appendOnly && (
        <Button type="button" variant="outline" size="sm" className="gap-1.5 border-[#262626] text-xs" onClick={() => onChange(defaultVoteRelays())}>
          <RotateCcw className="h-3 w-3" /> Reset to defaults
        </Button>
      )}
    </div>
  )
}

/** A locked date shown read-only (rather than a disabled picker, which can still be focused). */
function lockedDateLabel(date: string, time: string): string {
  if (!date) return '—'
  const ts = localToUnix(date, time)
  return ts ? new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : `${date} ${time}`
}

/** Start/End/Voting date+time row. Locks to read-only once the moment has passed. */
function DateTimeRow({ label, required, date, time, onDate, onTime, use12h, minDate, locked, lockReason }: {
  label: string; required?: boolean; date: string; time: string
  onDate: (v: string) => void; onTime: (v: string) => void; use12h: boolean; minDate?: string
  locked?: boolean; lockReason?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label} {required ? <span className="text-[#fc4462]">*</span> : <span className="text-neutral-600">(optional)</span>}</Label>
      {locked ? (
        <>
          <div className="flex items-center gap-2 rounded-lg border border-[#262626] bg-[#1a1a1a] px-3 py-2 text-sm text-neutral-400">
            <Lock className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
            {lockedDateLabel(date, time)}
          </div>
          {lockReason && <p className="text-[11px] text-neutral-500">{lockReason}</p>}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DatePicker value={date} onChange={onDate} placeholder="Select date" minDate={minDate} />
          <TimePicker value={time} onChange={onTime} use12h={use12h} />
        </div>
      )}
    </div>
  )
}

export function JamEditor({ editJam, onPublish, publishing }: {
  editJam?: JamDetails
  onPublish: (form: JamFormState) => Promise<void>
  publishing: boolean
}) {
  const [s, setS] = useState<EditorState>(() => (editJam ? stateFromJam(editJam) : emptyState()))
  const [use12h, setUse12h] = useState(browserUses12h())
  // "Adjust max score" disclosure — collapsed by default so most jams stay at 0–10.
  const [adjustMax, setAdjustMax] = useState(() => (editJam ? (editJam.scoreMax || 10) !== 10 : false))
  const [templateOpen, setTemplateOpen] = useState(false)

  // ─── Vote-relay counting support ──────────────────────────────────
  // Community votes are tallied by asking relays to COUNT ballots, so at least
  // one enabled vote relay has to support NIP-45 or there is no way to produce
  // community results at all.
  const [support, setSupport] = useState<Record<string, CountSupport>>({})
  const relayUrls = s.relays.map((r) => r.url).join(',')

  useEffect(() => {
    let cancelled = false
    for (const r of s.relays) {
      const known = cachedCountSupport(r.url)
      if (known !== 'unknown') { setSupport((p) => ({ ...p, [r.url]: known })); continue }
      setSupport((p) => (p[r.url] ? p : { ...p, [r.url]: 'checking' }))
      probeCountSupport(r.url).then((res) => { if (!cancelled) setSupport((p) => ({ ...p, [r.url]: res })) })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayUrls])

  const enabledRelays = s.relays.filter((r) => r.enabled)
  const canCommunityVote = enabledRelays.some((r) => support[r.url] === 'yes')
  // Don't judge until every enabled relay has answered — mid-probe we don't yet
  // know whether counting is available.
  const probingRelays = enabledRelays.some((r) => {
    const st = support[r.url]
    return !st || st === 'unknown' || st === 'checking'
  })

  // Removing or disabling the last counting relay silently strands community
  // voting, so turn it off with the relay rather than leaving a toggle on that
  // can no longer be honoured.
  useEffect(() => {
    if (!probingRelays && !canCommunityVote && s.userVotingEnabled) {
      set('userVotingEnabled', false)
      toast.warning('Community voting turned off — no enabled vote relay supports counting.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probingRelays, canCommunityVote, s.userVotingEnabled])
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) => setS((p) => ({ ...p, [k]: v }))

  // Editing: only enable saving once something actually differs from the jam we
  // loaded, so "Save changes" can't republish an identical revision (which would
  // still bump created_at). EditorState carries no metadata, so comparing the
  // whole snapshot is enough. Captured once — this component is remounted (keyed
  // on created_at) if a newer revision arrives.
  const publishedRef = useRef(s)
  const isDirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(publishedRef.current), [s])

  const votingOn = s.votingEnabled || s.userVotingEnabled

  // Moments that have already passed can't be rewritten — they'd retroactively
  // change which submissions and ballots count. Judged against the *published*
  // jam's dates, not the (editable) form values.
  // The margin is applied here too, so the form never offers a field that submit
  // would immediately revert.
  const now = useNow(30_000) + LOCK_MARGIN_SECONDS
  const startPassed = !!editJam && now >= editJam.start
  const endPassed = !!editJam && now >= editJam.end
  const votingEndPassed = !!editJam?.votingEnd && now >= editJam.votingEnd
  // Criteria and the max score decide whether an already-cast ballot is valid, so
  // they freeze the moment voting can begin (i.e. when submissions close).
  const scoringLocked = endPassed

  /**
   * Restore any field that locked while the editor was open, returning what was
   * put back. Reverting beats refusing the whole save: someone who also fixed a
   * typo in the description shouldn't lose that too.
   */
  const revertLockedFields = (nowTs: number): string[] => {
    if (!editJam) return []
    const pub = publishedRef.current
    const reverted: string[] = []
    const restore = <K extends keyof EditorState>(key: K) => {
      if (JSON.stringify(s[key]) !== JSON.stringify(pub[key])) setS((p) => ({ ...p, [key]: pub[key] }))
    }
    if (nowTs >= editJam.end) {
      const scoringChanged = (['customCriteria', 'criteria', 'scoreMax', 'votingEnabled', 'userVotingEnabled', 'judges'] as const)
        .filter((k) => JSON.stringify(s[k]) !== JSON.stringify(pub[k]))
      if (scoringChanged.length) {
        scoringChanged.forEach(restore)
        reverted.push('the voting setup')
      }
      if (s.endDate !== pub.endDate || s.endTime !== pub.endTime) {
        restore('endDate'); restore('endTime')
        reverted.push('the submission deadline')
      }
    }
    if (nowTs >= editJam.start && (s.startDate !== pub.startDate || s.startTime !== pub.startTime)) {
      restore('startDate'); restore('startTime')
      reverted.push('the start date')
    }
    if (editJam.votingEnd && nowTs >= editJam.votingEnd && (s.votingEndDate !== pub.votingEndDate || s.votingEndTime !== pub.votingEndTime)) {
      restore('votingEndDate'); restore('votingEndTime')
      reverted.push('the voting deadline')
    }
    return reverted
  }

  const submit = async () => {
    // The lock above is driven by a 30s timer, so an editor left open can still
    // render scoring as editable for a moment after voting opens. Re-check
    // against a fresh clock, with a margin covering the other direction too: our
    // clock decides the lock while the *voter's* decides whether their ballot
    // counts, so a slow clock here could otherwise let criteria move under
    // ballots that already count.
    if (editJam) {
      const reverted = revertLockedFields(Math.floor(Date.now() / 1000) + LOCK_MARGIN_SECONDS)
      if (reverted.length) {
        toast.warning(
          `Voting has opened, so ${reverted.join(' and ')} can no longer change — ${reverted.length === 1 ? 'it has' : 'they have'} been restored. Your other edits are ready to publish.`,
          { duration: 8000 },
        )
        return
      }
    }

    const start = localToUnix(s.startDate, s.startTime)
    const end = localToUnix(s.endDate, s.endTime)
    const votingEnd = votingOn ? localToUnix(s.votingEndDate, s.votingEndTime) : null
    const relays = s.relays.filter((r) => r.enabled).map((r) => r.url)

    if (!s.title.trim()) return toast.error('Enter a title')
    if (!s.image.trim()) return toast.error('Add a cover image')
    if (!s.summary.trim()) return toast.error('Enter a summary')
    if (!s.content.trim()) return toast.error('Enter the jam details')
    if (s.tags.length === 0) return toast.error('Add at least one tag')
    if (!start) return toast.error('Set the start date and time')
    if (!end) return toast.error('Set the end date and time')
    if (end <= start) return toast.error('The end must be after the start')
    if (votingOn && !votingEnd) return toast.error('Set when voting ends')
    if (votingOn && votingEnd && votingEnd < end) return toast.error('Voting must end on or after the jam ends')
    if (s.votingEnabled && s.judges.length === 0) return toast.error('Add at least one judge (or turn off judge voting)')
    const labels = s.customCriteria ? s.criteria.map((c) => c.trim()).filter(Boolean) : []
    if (s.customCriteria && labels.length < 2) return toast.error('Custom scoring needs at least 2 criteria')
    if (labels.length > MAX.criteria) return toast.error(`Up to ${MAX.criteria} criteria`)
    const criteria: JamCriterion[] = labels.map((label) => ({ label, max: s.scoreMax }))
    if (relays.length === 0) return toast.error('Enable at least one relay for votes')

    const form: JamFormState = {
      dTag: editJam?.dTag ?? crypto.randomUUID(),
      isEdit: !!editJam,
      previousCreatedAt: editJam?.createdAt,
      publishedAt: editJam?.publishedAt,
      title: s.title.trim(),
      featuredImageUrl: s.image.trim(),
      featuredVideoUrl: s.video.trim(),
      summary: s.summary.trim(),
      theme: s.theme.trim(),
      content: s.content,
      contentWarning: s.contentWarning,
      contentWarningReason: 'nsfw',
      screenshots: s.screenshots,
      games: s.games,
      tags: s.tags,
      jamType: MOD_JAM_TYPE,
      start, end,
      votingEnabled: s.votingEnabled,
      userVotingEnabled: s.userVotingEnabled,
      judges: s.judges,
      votingEnd,
      criteria,
      scoreMax: s.scoreMax,
      rewards: s.rewards,
      rewardNote: s.rewardNote,
      relays,
      faq: s.faq,
      rules: s.rules,
    }
    await onPublish(form)
  }

  return (
    <div className="space-y-4">
      {/* Basics */}
      <Section title="Basics">
        <div className="space-y-1.5">
          <Label>Title <span className="text-[#fc4462]">*</span></Label>
          <Input value={s.title} onChange={(e) => set('title', e.target.value)} placeholder="Winter Survival Mod Jam 2026" maxLength={LIMITS.title} className={inputCls} />
          <Counter value={s.title} max={LIMITS.title} />
        </div>
        <div className="space-y-1.5">
          <Label>Cover image <span className="text-[#fc4462]">*</span></Label>
          <BlossomUploadField accept={IMAGE_UPLOAD_ACCEPT} label="Drop an image or click to upload" sublabel="Mirrored to up to 3 servers" onUploaded={(r) => set('image', r.url)} resetAfter />
          <Input value={s.image} onChange={(e) => set('image', e.target.value)} placeholder="Cover image URL" maxLength={LIMITS.imageUrl} className={`${inputCls} font-mono text-xs`} />
          <Counter value={s.image} max={LIMITS.imageUrl} />
        </div>
        <div className="space-y-1.5">
          <Label>Trailer video URL</Label>
          <Input value={s.video} onChange={(e) => set('video', e.target.value)} placeholder="https://…" maxLength={LIMITS.videoUrl} className={inputCls} />
          <Counter value={s.video} max={LIMITS.videoUrl} />
        </div>
        <div className="space-y-1.5">
          <Label>Summary <span className="text-[#fc4462]">*</span></Label>
          <Textarea value={s.summary} onChange={(e) => set('summary', e.target.value)} rows={2} placeholder="One or two lines shown on cards" maxLength={LIMITS.summary} className={inputCls} />
          <Counter value={s.summary} max={LIMITS.summary} />
        </div>
        <div className="space-y-1.5">
          <Label>Theme <span className="text-neutral-600">(a word or phrase)</span></Label>
          <Input value={s.theme} onChange={(e) => set('theme', e.target.value)} placeholder="e.g. “Frozen wasteland”" maxLength={LIMITS.theme} className={inputCls} />
          <Counter value={s.theme} max={LIMITS.theme} />
          <p className="flex items-start gap-1.5 text-[11px] text-amber-400/90"><Info className="mt-0.5 h-3 w-3 shrink-0" /> The theme is shown on the jam the moment you publish — if you want to keep it a surprise until the jam starts, add it in a later edit.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Details <span className="text-[#fc4462]">*</span> <span className="text-neutral-600">(markdown)</span></Label>
          <Tabs defaultValue="edit" className="w-full">
            <TabsList className="border border-[#262626] bg-[#212121]">
              <TabsTrigger value="edit" className="gap-1.5 text-xs data-[state=active]:bg-[#2a2a2a]"><Pencil size={13} /> Edit</TabsTrigger>
              <TabsTrigger value="preview" className="gap-1.5 text-xs data-[state=active]:bg-[#2a2a2a]"><Eye size={13} /> Preview</TabsTrigger>
            </TabsList>
            <TabsContent value="edit" className="mt-3 space-y-2">
              <MarkdownToolbar textareaRef={bodyRef} value={s.content} onChange={(val) => set('content', val)} />
              <Textarea ref={bodyRef} value={s.content} onChange={(e) => set('content', e.target.value)} rows={8} placeholder="Theme, rules, timeline, prizes…" maxLength={LIMITS.content} className={cn(inputCls, 'min-h-[220px] resize-y')} />
              <Counter value={s.content} max={LIMITS.content} />
            </TabsContent>
            <TabsContent value="preview" className="mt-3">
              <div className="min-h-[220px] rounded-lg border border-[#262626] bg-[#212121] p-4">
                {s.content.trim() ? <Markdown content={s.content} /> : <span className="text-sm italic text-neutral-600">Nothing to preview</span>}
              </div>
            </TabsContent>
          </Tabs>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-[#212121] px-3 py-2">
          <span className="text-sm text-neutral-300">Mark as sensitive (NSFW)</span>
          <Switch checked={s.contentWarning} onCheckedChange={(v) => set('contentWarning', v)} />
        </div>
      </Section>

      {/* Games + tags + screenshots */}
      <Section title="Games & tags">
        <div className="space-y-1.5"><Label>Games <span className="text-neutral-600">(leave empty for a general "any game" jam)</span></Label><GameChipInput games={s.games} onChange={(v) => set('games', v)} maxLength={LIMITS.game} max={MAX.games} /></div>
        <div className="space-y-1.5"><Label>Tags <span className="text-[#fc4462]">*</span></Label><ChipInput items={s.tags} onChange={(v) => set('tags', v)} placeholder="Add a tag and press Enter" transform={(x) => x.toLowerCase()} maxLength={LIMITS.tag} max={MAX.tags} /></div>
        <div className="space-y-3">
          <Label>Promo screenshots</Label>
          <ScreenshotsEditor
            urls={s.screenshots}
            onChange={(urls) => set('screenshots', urls)}
            max={MAX.screenshots}
            maxUrlLength={LIMITS.screenshotUrl}
            inputClass={inputCls}
          />
        </div>
      </Section>

      {/* Dates & times */}
      <Section title="Dates & times">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-neutral-500" />
          <div className="flex overflow-hidden rounded-md border border-[#262626] text-xs">
            <button type="button" onClick={() => setUse12h(true)} className={cn('px-2.5 py-1', use12h ? 'bg-[#fc4462] text-white' : 'bg-[#212121] text-neutral-400')}>12h</button>
            <button type="button" onClick={() => setUse12h(false)} className={cn('px-2.5 py-1', !use12h ? 'bg-[#fc4462] text-white' : 'bg-[#212121] text-neutral-400')}>24h</button>
          </div>
        </div>
        <DateTimeRow
          label="Start" required date={s.startDate} time={s.startTime}
          onDate={(v) => set('startDate', v)} onTime={(v) => set('startTime', v)} use12h={use12h}
          locked={startPassed} lockReason="The jam has already started — moving this would change which submissions count."
        />
        <DateTimeRow
          label="End (submissions close)" required date={s.endDate} time={s.endTime}
          onDate={(v) => set('endDate', v)} onTime={(v) => set('endTime', v)} use12h={use12h} minDate={s.startDate}
          locked={endPassed} lockReason="Submissions have closed — moving this would change which entries count."
        />
        <p className="flex items-start gap-1.5 text-[11px] text-neutral-500"><Info className="mt-0.5 h-3 w-3 shrink-0" /> Times are entered in your local time. The jam is stored in UTC and shown to everyone in their own local time.</p>
      </Section>

      {/* Voting */}
      <Section title="Voting">
        {scoringLocked && (
          <p className="flex items-start gap-1.5 rounded-lg border border-[#262626] bg-[#1a1a1a] px-3 py-2 text-[11px] text-neutral-400">
            <Lock className="mt-0.5 h-3 w-3 shrink-0 text-neutral-500" />
            Voting is locked now that submissions have closed — who votes, what they score and the
            scale they score on all decide how ballots count, and people have already cast theirs.
          </p>
        )}

        <div className="flex items-center justify-between rounded-lg bg-[#212121] px-3 py-2">
          <div><p className="text-sm text-neutral-200">Judge voting</p><p className="text-[11px] text-neutral-500">Only the judges you list score entries.</p></div>
          <Switch checked={s.votingEnabled} onCheckedChange={(v) => set('votingEnabled', v)} disabled={scoringLocked} />
        </div>
        <div className="flex items-center justify-between rounded-lg bg-[#212121] px-3 py-2">
          <div>
            <p className="text-sm text-neutral-200">Community voting</p>
            <p className="text-[11px] text-neutral-500">Anyone can score entries (proof-of-worked).</p>
            {!scoringLocked && !canCommunityVote && (
              <p className="mt-1 text-[11px] text-amber-400">
                {probingRelays
                  ? 'Checking whether your vote relays support counting…'
                  : 'Needs a vote relay that supports counting — community votes are tallied by counting them, and none of your enabled relays can. Add one below.'}
              </p>
            )}
          </div>
          <Switch
            checked={s.userVotingEnabled}
            onCheckedChange={(v) => set('userVotingEnabled', v)}
            disabled={scoringLocked || probingRelays || !canCommunityVote}
          />
        </div>

        {s.votingEnabled && (
          <div className="space-y-1.5"><Label>Judges <span className="text-[#fc4462]">*</span> <span className="text-neutral-600">(name or npub)</span></Label><JudgeList judges={s.judges} onChange={(v) => set('judges', v)} maxLength={LIMITS.judge} max={MAX.judges} locked={scoringLocked} /></div>
        )}

        {votingOn && (
          <>
            <DateTimeRow
              label="Voting ends" required date={s.votingEndDate} time={s.votingEndTime}
              onDate={(v) => set('votingEndDate', v)} onTime={(v) => set('votingEndTime', v)} use12h={use12h} minDate={s.endDate}
              locked={votingEndPassed} lockReason="Voting has closed — moving this would change which ballots count."
            />

            <div className="flex items-center justify-between rounded-lg bg-[#212121] px-3 py-2">
              <div><p className="text-sm text-neutral-200">Custom scoring criteria</p><p className="text-[11px] text-neutral-500">Off = a single overall score.</p></div>
              <Switch checked={s.customCriteria} onCheckedChange={(v) => set('customCriteria', v)} disabled={scoringLocked} />
            </div>
            {s.customCriteria && (
              <div className="space-y-2">
                {s.criteria.map((label, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Input value={label} onChange={(e) => set('criteria', s.criteria.map((x, j) => j === i ? e.target.value : x))} placeholder="Criterion (e.g. Graphics)" maxLength={LIMITS.criterion} disabled={scoringLocked} className={`${inputCls} flex-1`} />
                      {!scoringLocked && s.criteria.length > 2 && <button type="button" onClick={() => set('criteria', s.criteria.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400"><X className="h-4 w-4" /></button>}
                    </div>
                    <Counter value={label} max={LIMITS.criterion} />
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    {!scoringLocked && s.criteria.length < MAX.criteria && (
                      <Button type="button" variant="outline" size="sm" className="border-[#262626] text-xs" onClick={() => set('criteria', [...s.criteria, ''])}><Plus className="mr-1 h-3 w-3" /> Add criterion</Button>
                    )}
                    {!scoringLocked && (
                      <Button type="button" variant="outline" size="sm" className="border-[#262626] text-xs" onClick={() => setTemplateOpen(true)}><Wand2 className="mr-1 h-3 w-3" /> Auto-fill from template</Button>
                    )}
                  </div>
                  <CountBadge n={s.criteria.length} max={MAX.criteria} />
                </div>
              </div>
            )}

            {/* Max score — hidden behind a toggle; governs every criterion and the overall score. */}
            <div className="space-y-2 rounded-lg bg-[#212121] px-3 py-2">
              <label className={cn('flex items-center justify-between', scoringLocked ? 'cursor-default' : 'cursor-pointer')}>
                <div><p className="text-sm text-neutral-200">Adjust max score</p><p className="text-[11px] text-neutral-500">{s.customCriteria ? 'Each criterion is scored' : 'The overall score is'} 0–{adjustMax ? s.scoreMax : 10}.</p></div>
                <Switch checked={adjustMax} onCheckedChange={(v) => { setAdjustMax(v); if (!v) set('scoreMax', 10) }} disabled={scoringLocked} />
              </label>
              {adjustMax && (
                <div className="flex items-center gap-3 pt-1">
                  <Slider min={2} max={100} step={1} value={[s.scoreMax]} onValueChange={([v]) => set('scoreMax', v)} disabled={scoringLocked} className="flex-1" />
                  <span className="w-10 text-right text-sm font-semibold tabular-nums text-[#fc4462]">{s.scoreMax}</span>
                  <button type="button" onClick={() => set('scoreMax', 10)} disabled={scoringLocked || s.scoreMax === 10} className="text-neutral-500 hover:text-[#fc4462] disabled:opacity-40" title="Reset to default (10)"><RotateCcw className="h-3.5 w-3.5" /></button>
                </div>
              )}
            </div>
          </>
        )}
      </Section>

      {/* Rewards */}
      <Section title="Rewards">
        {s.rewards.map((r, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex shrink-0 overflow-hidden rounded-md border border-[#262626] text-xs">
                <button type="button" onClick={() => set('rewards', s.rewards.map((x, j) => j === i ? { type: 'monetary', currency: '', amount: '' } : x))} className={cn('px-2 py-1.5', r.type === 'monetary' ? 'bg-[#fc4462] text-white' : 'bg-[#212121] text-neutral-400')}>Financial</button>
                <button type="button" onClick={() => set('rewards', s.rewards.map((x, j) => j === i ? { type: 'other', text: '' } : x))} className={cn('px-2 py-1.5', r.type === 'other' ? 'bg-[#fc4462] text-white' : 'bg-[#212121] text-neutral-400')}>Other</button>
              </div>
              {r.type === 'monetary' ? (
                <>
                  <Input value={r.currency} onChange={(e) => set('rewards', s.rewards.map((x, j) => j === i ? { ...x, currency: e.target.value } : x))} placeholder="USD / sats / €" maxLength={LIMITS.rewardCurrency} className={`${inputCls} w-28`} />
                  <Input value={r.amount} onChange={(e) => set('rewards', s.rewards.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} placeholder="Amount" maxLength={LIMITS.rewardAmount} className={`${inputCls} flex-1`} />
                </>
              ) : (
                <Input value={r.text} onChange={(e) => set('rewards', s.rewards.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} placeholder="e.g. Featured spot for a month" maxLength={LIMITS.rewardText} className={`${inputCls} flex-1`} />
              )}
              <button type="button" onClick={() => set('rewards', s.rewards.filter((_, j) => j !== i))} className="shrink-0 text-neutral-500 hover:text-red-400"><X className="h-4 w-4" /></button>
            </div>
            {r.type === 'monetary' ? (
              <div className="flex justify-end gap-4">
                <Counter value={r.currency} max={LIMITS.rewardCurrency} />
                <Counter value={r.amount} max={LIMITS.rewardAmount} />
              </div>
            ) : (
              <Counter value={r.text} max={LIMITS.rewardText} />
            )}
          </div>
        ))}
        <div className="flex items-center justify-between">
          {s.rewards.length < MAX.rewards
            ? <Button type="button" variant="outline" size="sm" className="border-[#262626] text-xs" onClick={() => set('rewards', [...s.rewards, { type: 'monetary', currency: '', amount: '' }])}><Plus className="mr-1 h-3 w-3" /> Add reward</Button>
            : <span />}
          <CountBadge n={s.rewards.length} max={MAX.rewards} />
        </div>
        <div className="space-y-1.5">
          <Label>How rewards are distributed</Label>
          <Textarea value={s.rewardNote} onChange={(e) => set('rewardNote', e.target.value)} rows={2} placeholder="e.g. 1st place takes the pool; runner-up gets…" maxLength={LIMITS.rewardNote} className={inputCls} />
          <Counter value={s.rewardNote} max={LIMITS.rewardNote} />
        </div>
      </Section>

      {/* Vote relays */}
      <Section title="Vote relays">
        <Label hint={scoringLocked
          ? 'Where votes are published and read.'
          : 'Where votes are published and read. Seeded from your client + user relays — toggle, remove, or reset to re-roll.'}>Relays <span className="text-[#fc4462]">*</span></Label>
        {scoringLocked && (
          // Append-only rather than fully locked: dropping a relay now would hide
          // ballots already sitting on it, but adding one can only help the tally
          // find more of them.
          <p className="flex items-start gap-1.5 rounded-lg border border-[#262626] bg-[#1a1a1a] px-3 py-2 text-[11px] text-neutral-400">
            <Lock className="mt-0.5 h-3 w-3 shrink-0 text-neutral-500" />
            Voting is underway, so relays can only be added — removing one would hide ballots
            already stored there from the tally.
          </p>
        )}
        <VoteRelayList relays={s.relays} onChange={(v) => set('relays', v)} appendOnly={scoringLocked} support={support} />
      </Section>

      {/* Rules */}
      <Section title="Rules">
        {s.rules.map((r, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-[#262626] p-2">
            <div className="flex items-center gap-2">
              <Input value={r.title} onChange={(e) => set('rules', s.rules.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder="Rule (e.g. One submission per person)" maxLength={LIMITS.ruleTitle} className={`${inputCls} flex-1`} />
              <button type="button" onClick={() => set('rules', s.rules.filter((_, j) => j !== i))} className="shrink-0 text-neutral-500 hover:text-red-400"><X className="h-4 w-4" /></button>
            </div>
            <Counter value={r.title} max={LIMITS.ruleTitle} />
            <Textarea value={r.detail} onChange={(e) => set('rules', s.rules.map((x, j) => j === i ? { ...x, detail: e.target.value } : x))} rows={2} placeholder="The detail behind it" maxLength={LIMITS.ruleDetail} className={inputCls} />
            <Counter value={r.detail} max={LIMITS.ruleDetail} />
          </div>
        ))}
        <div className="flex items-center justify-between">
          {s.rules.length < MAX.rules
            ? <Button type="button" variant="outline" size="sm" className="border-[#262626] text-xs" onClick={() => set('rules', [...s.rules, { title: '', detail: '' }])}><Plus className="mr-1 h-3 w-3" /> Add rule</Button>
            : <span />}
          <CountBadge n={s.rules.length} max={MAX.rules} />
        </div>
      </Section>

      {/* FAQ */}
      <Section title="FAQ">
        {s.faq.map((f, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-[#262626] p-2">
            <div className="flex items-center gap-2">
              <Input value={f.question} onChange={(e) => set('faq', s.faq.map((x, j) => j === i ? { ...x, question: e.target.value } : x))} placeholder="Question" maxLength={LIMITS.faqQuestion} className={`${inputCls} flex-1`} />
              <button type="button" onClick={() => set('faq', s.faq.filter((_, j) => j !== i))} className="shrink-0 text-neutral-500 hover:text-red-400"><X className="h-4 w-4" /></button>
            </div>
            <Counter value={f.question} max={LIMITS.faqQuestion} />
            <Textarea value={f.answer} onChange={(e) => set('faq', s.faq.map((x, j) => j === i ? { ...x, answer: e.target.value } : x))} rows={2} placeholder="Answer" maxLength={LIMITS.faqAnswer} className={inputCls} />
            <Counter value={f.answer} max={LIMITS.faqAnswer} />
          </div>
        ))}
        <div className="flex items-center justify-between">
          {s.faq.length < MAX.faq
            ? <Button type="button" variant="outline" size="sm" className="border-[#262626] text-xs" onClick={() => set('faq', [...s.faq, { question: '', answer: '' }])}><Plus className="mr-1 h-3 w-3" /> Add Q&amp;A</Button>
            : <span />}
          <CountBadge n={s.faq.length} max={MAX.faq} />
        </div>
      </Section>

      <Button onClick={submit} disabled={publishing || (!!editJam && !isDirty)} className="w-full gap-2 bg-[#fc4462] text-white hover:bg-[#e23a56] disabled:opacity-50">
        {publishing ? <><Loader2 className="h-4 w-4 animate-spin" /> Publishing…</> : editJam ? 'Save changes' : 'Publish Mod Jam'}
      </Button>
      {editJam && !isDirty && !publishing && (
        <p className="text-center text-[11px] text-neutral-500">No changes yet.</p>
      )}

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="border-[#262626] bg-[#1a1a1a] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Auto-fill from template</DialogTitle>
            <DialogDescription className="text-neutral-400">
              This replaces every criterion you&apos;ve written with the set below. You can edit or
              remove any of them afterwards.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-1 py-1">
            {CRITERIA_TEMPLATE.map((c, i) => (
              <li key={c} className="flex items-center gap-2.5 rounded-md bg-[#212121] px-3 py-1.5 text-sm text-neutral-200">
                <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-neutral-500">{i + 1}</span>
                {c}
              </li>
            ))}
          </ol>
          <DialogFooter>
            <Button variant="outline" className="border-[#262626]" onClick={() => setTemplateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => { set('criteria', [...CRITERIA_TEMPLATE]); setTemplateOpen(false) }}
              className="bg-[#fc4462] text-white hover:bg-[#e23a56]"
            >
              Replace criteria
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
