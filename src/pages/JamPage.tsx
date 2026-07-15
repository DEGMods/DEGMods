import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { CalendarDays, Trophy, Gamepad2, Clock, Gift, Users, Scale, HelpCircle, FileUp, ListOrdered, Pencil, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CollapsibleMarkdown } from '@/components/mod/CollapsibleMarkdown'
import { ModScreenshots } from '@/components/mod/ModScreenshots'
import { ShareBox } from '@/components/mod/ShareBox'
import { PublisherCard } from '@/components/mod/PublisherCard'
import { SidebarAd } from '@/components/mod/SidebarAd'
import { ReactionButton } from '@/components/social/ReactionButton'
import { ZapButton } from '@/components/social/ZapButton'
import { CommentSection } from '@/components/social/CommentSection'
import { PoopIcon } from '@/components/icons/PoopIcon'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { useNow } from '@/hooks/useNow'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { extractJam, jamStatus, jamCountdownLabel, submissionsOpen, type JamDetails } from '@/lib/nostr/jam'
import { KINDS } from '@/lib/constants'
import type { NostrTarget } from '@/lib/nostr/social'
import { cn } from '@/lib/utils'

const fmt = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const STATUS_COLOR: Record<string, string> = { upcoming: 'text-sky-400', active: 'text-[#fc4462]', voting: 'text-amber-400', ended: 'text-neutral-500' }

function InfoRow({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-neutral-400">{label}</span>
      <span className={cn('text-right font-medium', active ? 'text-[#fc4462]' : 'text-neutral-200')}>{value}</span>
    </div>
  )
}

const Section = ({ icon: Icon, title, children }: { icon: typeof Trophy; title: string; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-xl border border-[#262626] bg-[#1c1c1c] p-4">
    <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><Icon className="h-5 w-5 text-[#fc4462]" /> {title}</h2>
    {children}
  </section>
)

export function JamPage() {
  const { naddr } = useParams<{ naddr: string }>()
  const navigate = useNavigate()
  const myPubkey = useAuthStore((s) => s.pubkey)
  const now = useNow()
  const [jam, setJam] = useState<JamDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setNotFound(false)
    let decoded
    try { decoded = nip19.decode(naddr!) } catch { setNotFound(true); setLoading(false); return }
    if (decoded.type !== 'naddr' || decoded.data.kind !== KINDS.JAM) { setNotFound(true); setLoading(false); return }
    const { pubkey, identifier } = decoded.data
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchLatestEvent(relays, { kinds: [KINDS.JAM], authors: [pubkey], '#d': [identifier] })
      .then((ev) => { if (cancelled) return; const j = ev ? extractJam(ev) : null; if (j) setJam(j); else setNotFound(true) })
      .catch(() => { if (!cancelled) setNotFound(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [naddr])

  if (loading) return <div className="flex items-center justify-center py-24 text-neutral-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading jam…</div>
  if (notFound || !jam) return <div className="py-24 text-center text-neutral-400">Mod jam not found.</div>

  const status = jamStatus(jam, now)
  const target: NostrTarget = { id: jam.id, pubkey: jam.pubkey, kind: KINDS.JAM, aTag: jam.coordinate }
  const hasWarning = !!jam.contentWarning && !revealed
  const isAuthor = myPubkey === jam.pubkey
  const canSubmit = status === 'active'
  const canViewSubs = submissionsOpen(jam, now)
  const submitTip = status === 'upcoming' ? `Opens when the jam starts (${jamCountdownLabel(jam, now)})` : 'Submissions are closed'
  const subsTip = 'Available once submissions close'

  return (
    <div className="py-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Main */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {/* Hero */}
          <div className="relative aspect-video overflow-hidden rounded-xl border border-[#262626]">
            {jam.video ? (
              <video src={jam.video} poster={jam.image} controls className="h-full w-full object-cover" />
            ) : jam.image ? (
              <SkeletonImage src={jam.image} alt={jam.title} className={cn('h-full w-full object-cover', hasWarning && 'blur-2xl')} />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#212121] text-neutral-600">No image</div>
            )}
            {hasWarning && (
              <button onClick={() => setRevealed(true)} className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/60 text-neutral-300">
                <AlertTriangle className="h-7 w-7 text-yellow-500" />
                <span className="text-sm font-medium">{jam.contentWarning}</span>
                <span className="text-xs text-neutral-500">Click to reveal</span>
              </button>
            )}
            <span className={cn('absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-xs font-medium backdrop-blur-sm', STATUS_COLOR[status])}>
              <Clock className="h-3.5 w-3.5" /> {jamCountdownLabel(jam, now)}
            </span>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[#fc4462]">
              <Gamepad2 className="h-4 w-4" />
              {jam.games.length === 0 ? <span>Any game</span> : jam.games.map((g) => <span key={g} className="rounded-md bg-[#fc4462]/15 px-2 py-0.5">{g}</span>)}
            </div>
            <h1 className="text-3xl font-bold text-white">{jam.title}</h1>
            {jam.summary && <p className="text-lg leading-relaxed text-neutral-300">{jam.summary}</p>}
          </div>

          {/* Reactions + zap */}
          <div className="flex items-center gap-2">
            <ReactionButton target={target} bucket="positive" />
            <ReactionButton target={target} content="💩" bucket="negative" icon={PoopIcon} />
            <ZapButton target={target} />
          </div>

          {jam.content && <div className="rounded-xl border border-[#262626] bg-[#1c1c1c] p-4"><CollapsibleMarkdown content={jam.content} /></div>}

          {jam.screenshots.length > 0 && (
            <Section icon={Gamepad2} title="Gallery"><ModScreenshots screenshots={jam.screenshots} blurred={hasWarning} onReveal={() => setRevealed(true)} /></Section>
          )}

          {/* Schedule */}
          <Section icon={CalendarDays} title="Schedule">
            <InfoRow label="Starts" value={fmt(jam.start)} active={status === 'upcoming'} />
            <InfoRow label="Submissions close" value={fmt(jam.end)} active={status === 'active'} />
            {jam.votingEnd && <InfoRow label="Voting ends" value={fmt(jam.votingEnd)} active={status === 'voting'} />}
            <p className="pt-1 text-[11px] text-neutral-500">Shown in your local time.</p>
          </Section>

          {/* Voting */}
          {(jam.votingEnabled || jam.userVotingEnabled) && (
            <Section icon={Scale} title="Voting">
              <div className="flex flex-wrap gap-2 text-xs">
                {jam.votingEnabled && <span className="rounded-md bg-[#262626] px-2 py-1 text-neutral-200">Judge voting</span>}
                {jam.userVotingEnabled && <span className="rounded-md bg-[#262626] px-2 py-1 text-neutral-200">Community voting</span>}
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-neutral-400">Scored on</p>
                <div className="flex flex-wrap gap-1.5">
                  {(jam.criteria.length ? jam.criteria.map((c) => `${c.label} (0–${c.max})`) : ['Overall (0–10)']).map((c) => (
                    <span key={c} className="rounded-md border border-[#262626] px-2 py-1 text-xs text-neutral-300">{c}</span>
                  ))}
                </div>
              </div>
              {jam.votingEnabled && jam.judges.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-neutral-400"><Users className="h-3.5 w-3.5" /> Judges</p>
                  <div className="flex flex-wrap gap-1.5">{jam.judges.map((j) => <span key={j} className="rounded-md bg-[#262626] px-2 py-1 text-xs text-neutral-300">{j.startsWith('npub') ? `${j.slice(0, 12)}…` : j}</span>)}</div>
                </div>
              )}
            </Section>
          )}

          {/* Rewards */}
          {(jam.rewards.length > 0 || jam.rewardNote) && (
            <Section icon={Gift} title="Rewards">
              {jam.rewards.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {jam.rewards.map((r, i) => (
                    <span key={i} className="rounded-lg border border-[#fc4462]/30 bg-[#fc4462]/10 px-3 py-1.5 text-sm font-medium text-[#fc4462]">
                      {r.type === 'monetary' ? `${r.amount} ${r.currency}` : r.text}
                    </span>
                  ))}
                </div>
              )}
              {jam.rewardNote && <p className="whitespace-pre-wrap text-sm text-neutral-400">{jam.rewardNote}</p>}
            </Section>
          )}

          {/* FAQ */}
          {jam.faq.length > 0 && (
            <Section icon={HelpCircle} title="FAQ">
              <div className="space-y-3">
                {jam.faq.map((f, i) => (
                  <div key={i}><p className="text-sm font-medium text-neutral-200">{f.question}</p><p className="mt-0.5 text-sm text-neutral-400">{f.answer}</p></div>
                ))}
              </div>
            </Section>
          )}

          <CommentSection root={target} />
        </div>

        {/* Sidebar */}
        <div className="space-y-4 lg:sticky lg:top-20 self-start">
          <TooltipProvider delayDuration={150}>
            <div className="space-y-2 rounded-xl border border-[#262626] bg-[#1c1c1c] p-3">
              {isAuthor && (
                <Button variant="outline" className="w-full gap-2 border-[#262626]" onClick={() => navigate(`/mod-jam/${naddr}/edit`)}>
                  <Pencil className="h-4 w-4" /> Edit jam
                </Button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <Button disabled={!canSubmit} onClick={() => navigate(`/submit-mod?jam=${naddr}`)} className="w-full gap-2 bg-[#fc4462] text-white hover:bg-[#e23a56] disabled:opacity-50">
                      <FileUp className="h-4 w-4" /> Submit a mod
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canSubmit && <TooltipContent>{submitTip}</TooltipContent>}
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <Button variant="outline" disabled={!canViewSubs} onClick={() => navigate(`/mod-jam/${naddr}/submissions`)} className="w-full gap-2 border-[#262626] disabled:opacity-50">
                      <ListOrdered className="h-4 w-4" /> Show submissions
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canViewSubs && <TooltipContent>{subsTip}</TooltipContent>}
              </Tooltip>
            </div>
          </TooltipProvider>

          <PublisherCard pubkey={jam.pubkey} />
          <div className="rounded-xl border border-[#262626] bg-[#1c1c1c] p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Published</p>
            <p className="text-sm text-neutral-300">{fmt(jam.publishedAt)}</p>
          </div>
          {naddr && <ShareBox url={`${window.location.origin}/mod-jam/${naddr}`} title={jam.title} />}
          <SidebarAd />
        </div>
      </div>
    </div>
  )
}
