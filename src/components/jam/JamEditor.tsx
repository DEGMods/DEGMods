import { useState } from 'react'
import { CalendarDays, Clock, Plus, X, Trophy, Gamepad2, Info, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { BlossomUploadField } from '@/components/upload/BlossomUploadField'
import { DatePicker } from './DatePicker'
import { TimePicker, browserUses12h } from './TimePicker'
import { IMAGE_UPLOAD_ACCEPT } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settingsStore'
import { localToUnix, type JamFormState, type JamReward, type JamCriterion, type JamFaq } from '@/lib/nostr/jam'
import { cn } from '@/lib/utils'

interface EditorState {
  title: string
  image: string
  video: string
  summary: string
  content: string
  contentWarning: boolean
  contentWarningReason: string
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
  criteria: JamCriterion[]
  rewards: JamReward[]
  rewardNote: string
  relays: string[]
  faq: JamFaq[]
}

function emptyState(): EditorState {
  // Seed relays from the user's enabled write relays (up to 3) — the safety net
  // so the creator doesn't have to think about where ballots get published.
  const relays = useSettingsStore.getState().getAllEnabledRelayUrls('write').slice(0, 3)
  return {
    title: '', image: '', video: '', summary: '', content: '',
    contentWarning: false, contentWarningReason: '',
    screenshots: [], games: [], tags: [],
    startDate: '', startTime: '', endDate: '', endTime: '',
    votingEnabled: false, userVotingEnabled: false, judges: [],
    votingEndDate: '', votingEndTime: '',
    customCriteria: false, criteria: [{ label: '', max: 10 }, { label: '', max: 10 }],
    rewards: [], rewardNote: '', relays, faq: [],
  }
}

const Section = ({ icon: Icon, title, children }: { icon?: typeof Trophy; title: string; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-xl border border-[#262626] bg-[#1c1c1c] p-4">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-white">{Icon && <Icon className="h-4 w-4 text-[#fc4462]" />}{title}</h2>
    {children}
  </section>
)

const Label = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <label className="text-xs font-medium text-neutral-400">{children}{hint && <span className="ml-1 text-neutral-600">{hint}</span>}</label>
)

const inputCls = 'border-[#262626] bg-[#212121] text-white placeholder:text-neutral-500'

/** A chip-list input (games, tags): type + Enter to add, click × to remove. */
function ChipInput({ items, onChange, placeholder, transform }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; transform?: (s: string) => string }) {
  const [val, setVal] = useState('')
  const add = () => {
    const v = (transform ? transform(val) : val).trim()
    if (v && !items.includes(v)) onChange([...items, v])
    setVal('')
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} placeholder={placeholder} className={inputCls} />
        <Button type="button" variant="outline" className="shrink-0 border-[#262626]" onClick={add}><Plus className="h-4 w-4" /></Button>
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

/** Start/End/Voting date+time row. */
function DateTimeRow({ label, required, date, time, onDate, onTime, use12h, minDate }: {
  label: string; required?: boolean; date: string; time: string
  onDate: (v: string) => void; onTime: (v: string) => void; use12h: boolean; minDate?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label} {required ? <span className="text-[#fc4462]">*</span> : <span className="text-neutral-600">(optional)</span>}</Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <DatePicker value={date} onChange={onDate} placeholder="Select date" minDate={minDate} />
        <TimePicker value={time} onChange={onTime} use12h={use12h} />
      </div>
    </div>
  )
}

export function JamEditor({ initial, onPublish, publishing }: {
  initial?: Partial<EditorState>
  onPublish: (form: JamFormState) => Promise<void>
  publishing: boolean
}) {
  const [s, setS] = useState<EditorState>(() => ({ ...emptyState(), ...initial }))
  const [use12h, setUse12h] = useState(browserUses12h())
  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) => setS((p) => ({ ...p, [k]: v }))

  const votingOn = s.votingEnabled || s.userVotingEnabled

  const submit = async () => {
    const start = localToUnix(s.startDate, s.startTime)
    const end = localToUnix(s.endDate, s.endTime)
    const votingEnd = votingOn ? localToUnix(s.votingEndDate, s.votingEndTime) : null

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
    const criteria = s.customCriteria ? s.criteria.filter((c) => c.label.trim()) : []
    if (s.customCriteria && criteria.length < 2) return toast.error('Custom scoring needs at least 2 criteria')
    if (criteria.length > 6) return toast.error('Up to 6 criteria')
    if (s.relays.length === 0) return toast.error('Add at least one relay for votes')

    const form: JamFormState = {
      dTag: crypto.randomUUID(),
      title: s.title.trim(),
      featuredImageUrl: s.image.trim(),
      featuredVideoUrl: s.video.trim(),
      summary: s.summary.trim(),
      content: s.content,
      contentWarning: s.contentWarning,
      contentWarningReason: s.contentWarningReason.trim() || 'nsfw',
      screenshots: s.screenshots,
      games: s.games,
      tags: s.tags,
      jamType: 'mod',
      start, end,
      votingEnabled: s.votingEnabled,
      userVotingEnabled: s.userVotingEnabled,
      judges: s.judges,
      votingEnd,
      criteria,
      rewards: s.rewards,
      rewardNote: s.rewardNote,
      relays: s.relays,
      faq: s.faq,
    }
    await onPublish(form)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Basics */}
      <Section icon={Trophy} title="Basics">
        <div className="space-y-1.5"><Label>Title <span className="text-[#fc4462]">*</span></Label><Input value={s.title} onChange={(e) => set('title', e.target.value)} placeholder="Winter Survival Mod Jam 2026" className={inputCls} /></div>
        <div className="space-y-1.5">
          <Label>Cover image <span className="text-[#fc4462]">*</span></Label>
          <BlossomUploadField accept={IMAGE_UPLOAD_ACCEPT} label="Drop an image or click to upload" sublabel="Mirrored to up to 3 servers" onUploaded={(r) => set('image', r.url)} resetAfter />
          <Input value={s.image} onChange={(e) => set('image', e.target.value)} placeholder="Cover image URL" className={`${inputCls} font-mono text-xs`} />
        </div>
        <div className="space-y-1.5"><Label>Trailer video URL</Label><Input value={s.video} onChange={(e) => set('video', e.target.value)} placeholder="https://…" className={inputCls} /></div>
        <div className="space-y-1.5"><Label>Summary <span className="text-[#fc4462]">*</span></Label><Textarea value={s.summary} onChange={(e) => set('summary', e.target.value)} rows={2} placeholder="One or two lines shown on cards" className={inputCls} /></div>
        <div className="space-y-1.5"><Label>Details <span className="text-[#fc4462]">*</span> <span className="text-neutral-600">(markdown)</span></Label><Textarea value={s.content} onChange={(e) => set('content', e.target.value)} rows={8} placeholder="Theme, rules, timeline, prizes…" className={inputCls} /></div>
        <div className="flex items-center justify-between rounded-lg bg-[#212121] px-3 py-2">
          <span className="text-sm text-neutral-300">Mark as sensitive (NSFW)</span>
          <Switch checked={s.contentWarning} onCheckedChange={(v) => set('contentWarning', v)} />
        </div>
        {s.contentWarning && <Input value={s.contentWarningReason} onChange={(e) => set('contentWarningReason', e.target.value)} placeholder="Reason (optional)" className={inputCls} />}
      </Section>

      {/* Games + tags + screenshots */}
      <Section icon={Gamepad2} title="Games & tags">
        <div className="space-y-1.5"><Label>Games <span className="text-neutral-600">(leave empty for a general "any game" jam)</span></Label><ChipInput items={s.games} onChange={(v) => set('games', v)} placeholder="Add a game and press Enter" /></div>
        <div className="space-y-1.5"><Label>Tags <span className="text-[#fc4462]">*</span></Label><ChipInput items={s.tags} onChange={(v) => set('tags', v)} placeholder="Add a tag and press Enter" transform={(x) => x.toLowerCase()} /></div>
        <div className="space-y-1.5">
          <Label>Promo screenshots</Label>
          <BlossomUploadField accept={IMAGE_UPLOAD_ACCEPT} label="Upload a screenshot" onUploaded={(r) => set('screenshots', [...s.screenshots, r.url])} resetAfter />
          {s.screenshots.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {s.screenshots.map((url, i) => (
                <div key={i} className="relative">
                  <img src={url} alt="" className="h-16 w-24 rounded-md border border-[#262626] object-cover" />
                  <button type="button" onClick={() => set('screenshots', s.screenshots.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-black/80 p-0.5 text-neutral-300 hover:text-red-400"><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* Dates & times */}
      <Section icon={CalendarDays} title="Dates & times">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-neutral-500" />
          <div className="flex overflow-hidden rounded-md border border-[#262626] text-xs">
            <button type="button" onClick={() => setUse12h(true)} className={cn('px-2.5 py-1', use12h ? 'bg-[#fc4462] text-white' : 'bg-[#212121] text-neutral-400')}>12h</button>
            <button type="button" onClick={() => setUse12h(false)} className={cn('px-2.5 py-1', !use12h ? 'bg-[#fc4462] text-white' : 'bg-[#212121] text-neutral-400')}>24h</button>
          </div>
        </div>
        <DateTimeRow label="Start" required date={s.startDate} time={s.startTime} onDate={(v) => set('startDate', v)} onTime={(v) => set('startTime', v)} use12h={use12h} />
        <DateTimeRow label="End (submissions close)" required date={s.endDate} time={s.endTime} onDate={(v) => set('endDate', v)} onTime={(v) => set('endTime', v)} use12h={use12h} minDate={s.startDate} />
        <p className="flex items-start gap-1.5 text-[11px] text-neutral-500"><Info className="mt-0.5 h-3 w-3 shrink-0" /> Times are entered in your local time. The jam is stored in UTC and shown to everyone in their own local time.</p>
      </Section>

      {/* Voting */}
      <Section icon={Trophy} title="Voting">
        <div className="flex items-center justify-between rounded-lg bg-[#212121] px-3 py-2">
          <div><p className="text-sm text-neutral-200">Judge voting</p><p className="text-[11px] text-neutral-500">Only the judges you list score entries.</p></div>
          <Switch checked={s.votingEnabled} onCheckedChange={(v) => set('votingEnabled', v)} />
        </div>
        <div className="flex items-center justify-between rounded-lg bg-[#212121] px-3 py-2">
          <div><p className="text-sm text-neutral-200">Community voting</p><p className="text-[11px] text-neutral-500">Anyone can score entries (proof-of-worked).</p></div>
          <Switch checked={s.userVotingEnabled} onCheckedChange={(v) => set('userVotingEnabled', v)} />
        </div>

        {s.votingEnabled && (
          <div className="space-y-1.5"><Label>Judges <span className="text-[#fc4462]">*</span> <span className="text-neutral-600">(name or npub)</span></Label><ChipInput items={s.judges} onChange={(v) => set('judges', v)} placeholder="Add a judge and press Enter" /></div>
        )}

        {votingOn && (
          <>
            <DateTimeRow label="Voting ends" required date={s.votingEndDate} time={s.votingEndTime} onDate={(v) => set('votingEndDate', v)} onTime={(v) => set('votingEndTime', v)} use12h={use12h} minDate={s.endDate} />

            <div className="flex items-center justify-between rounded-lg bg-[#212121] px-3 py-2">
              <div><p className="text-sm text-neutral-200">Custom scoring criteria</p><p className="text-[11px] text-neutral-500">Off = a single overall 0–10 score.</p></div>
              <Switch checked={s.customCriteria} onCheckedChange={(v) => set('customCriteria', v)} />
            </div>
            {s.customCriteria && (
              <div className="space-y-2">
                {s.criteria.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={c.label} onChange={(e) => set('criteria', s.criteria.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Criterion (e.g. Graphics)" className={`${inputCls} flex-1`} />
                    <Input type="number" value={c.max} onChange={(e) => set('criteria', s.criteria.map((x, j) => j === i ? { ...x, max: Number(e.target.value) || 10 } : x))} className={`${inputCls} w-20`} title="Max score" />
                    {s.criteria.length > 2 && <button type="button" onClick={() => set('criteria', s.criteria.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400"><X className="h-4 w-4" /></button>}
                  </div>
                ))}
                {s.criteria.length < 6 && <Button type="button" variant="outline" size="sm" className="border-[#262626] text-xs" onClick={() => set('criteria', [...s.criteria, { label: '', max: 10 }])}><Plus className="mr-1 h-3 w-3" /> Add criterion</Button>}
              </div>
            )}
          </>
        )}
      </Section>

      {/* Rewards */}
      <Section icon={Trophy} title="Rewards">
        {s.rewards.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-[#262626] text-xs">
              <button type="button" onClick={() => set('rewards', s.rewards.map((x, j) => j === i ? { type: 'monetary', currency: '', amount: '' } : x))} className={cn('px-2 py-1.5', r.type === 'monetary' ? 'bg-[#fc4462] text-white' : 'bg-[#212121] text-neutral-400')}>$</button>
              <button type="button" onClick={() => set('rewards', s.rewards.map((x, j) => j === i ? { type: 'other', text: '' } : x))} className={cn('px-2 py-1.5', r.type === 'other' ? 'bg-[#fc4462] text-white' : 'bg-[#212121] text-neutral-400')}>Other</button>
            </div>
            {r.type === 'monetary' ? (
              <>
                <Input value={r.currency} onChange={(e) => set('rewards', s.rewards.map((x, j) => j === i ? { ...x, currency: e.target.value } : x))} placeholder="USD / sats / €" className={`${inputCls} w-28`} />
                <Input value={r.amount} onChange={(e) => set('rewards', s.rewards.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} placeholder="Amount" className={`${inputCls} flex-1`} />
              </>
            ) : (
              <Input value={r.text} onChange={(e) => set('rewards', s.rewards.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} placeholder="e.g. Featured spot for a month" className={`${inputCls} flex-1`} />
            )}
            <button type="button" onClick={() => set('rewards', s.rewards.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400"><X className="h-4 w-4" /></button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="border-[#262626] text-xs" onClick={() => set('rewards', [...s.rewards, { type: 'monetary', currency: '', amount: '' }])}><Plus className="mr-1 h-3 w-3" /> Add reward</Button>
        <div className="space-y-1.5"><Label>How rewards are distributed</Label><Textarea value={s.rewardNote} onChange={(e) => set('rewardNote', e.target.value)} rows={2} placeholder="e.g. 1st place takes the pool; runner-up gets…" className={inputCls} /></div>
      </Section>

      {/* Relays + FAQ */}
      <Section title="Vote relays">
        <Label hint="Where votes are published and read. We seeded your relays — edit as you like.">Relays <span className="text-[#fc4462]">*</span></Label>
        <ChipInput items={s.relays} onChange={(v) => set('relays', v)} placeholder="wss://…" />
      </Section>

      <Section title="FAQ">
        {s.faq.map((f, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-[#262626] p-2">
            <div className="flex items-center gap-2">
              <Input value={f.question} onChange={(e) => set('faq', s.faq.map((x, j) => j === i ? { ...x, question: e.target.value } : x))} placeholder="Question" className={`${inputCls} flex-1`} />
              <button type="button" onClick={() => set('faq', s.faq.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400"><X className="h-4 w-4" /></button>
            </div>
            <Textarea value={f.answer} onChange={(e) => set('faq', s.faq.map((x, j) => j === i ? { ...x, answer: e.target.value } : x))} rows={2} placeholder="Answer" className={inputCls} />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="border-[#262626] text-xs" onClick={() => set('faq', [...s.faq, { question: '', answer: '' }])}><Plus className="mr-1 h-3 w-3" /> Add Q&amp;A</Button>
      </Section>

      <Button onClick={submit} disabled={publishing} className="w-full gap-2 bg-[#fc4462] text-white hover:bg-[#e23a56]">
        {publishing ? <><Loader2 className="h-4 w-4 animate-spin" /> Publishing…</> : 'Publish Mod Jam'}
      </Button>
    </div>
  )
}
