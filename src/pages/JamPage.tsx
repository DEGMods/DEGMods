import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useShortUrl } from '@/hooks/useShortUrl'
import { decodePostParam, selectorFor } from '@/lib/nostr/nipShort'
import { ShortAddressChooser, postPreview } from '@/components/social/ShortAddressChooser'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { toast } from 'sonner'
import { Gamepad2, Clock, Users, Scale, FileUp, ListOrdered, Pencil, Loader2, AlertTriangle, MoreHorizontal, Copy, FileJson, RefreshCw, ChevronDown, Trash2, ChevronLeft } from 'lucide-react'
import { JamTallyModal } from '@/components/jam/JamTallyModal'
import { JudgeRow } from '@/components/jam/JudgeList'
import { CopyShortLinkItem } from '@/components/shared/CopyShortLinkItem'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
import { fetchEvent, fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { getCachedEvent, whenEventCacheReady } from '@/lib/nostr/eventCache'
import { extractJam, isModJam, jamStatus, jamCountdownLabel, type JamDetails } from '@/lib/nostr/jam'
import { isDeleted } from '@/lib/nostr/events'
import { RequestDeleteDialog } from '@/components/shared/RequestDeleteDialog'
import { KINDS } from '@/lib/constants'
import type { NostrTarget } from '@/lib/nostr/social'
import { cn } from '@/lib/utils'

const fmt = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const fmtLong = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const STATUS_COLOR: Record<string, string> = { upcoming: 'text-sky-400', active: 'text-[#fc4462]', voting: 'text-amber-400', ended: 'text-neutral-500' }

/** Per-status styling + wording for the full-width timing band. */
const STATUS_BAND: Record<string, { label: string; box: string; dot: string; text: string }> = {
  upcoming: { label: 'Upcoming', box: 'border-sky-400/30 bg-sky-400/10', dot: 'bg-sky-400', text: 'text-sky-400' },
  active: { label: 'Open for submissions', box: 'border-[#fc4462]/30 bg-[#fc4462]/10', dot: 'bg-[#fc4462]', text: 'text-[#fc4462]' },
  voting: { label: 'Voting', box: 'border-amber-400/30 bg-amber-400/10', dot: 'bg-amber-400', text: 'text-amber-400' },
  ended: { label: 'Ended', box: 'border-[#262626] bg-[#212121]', dot: 'bg-neutral-500', text: 'text-neutral-400' },
}

/** The one date that matters at this point in the jam's life. */
function statusMilestone(jam: JamDetails, status: string): string | null {
  switch (status) {
    case 'upcoming': return `Starts ${fmt(jam.start)}`
    case 'active': return `Submissions close ${fmt(jam.end)}`
    case 'voting': return jam.votingEnd ? `Voting closes ${fmt(jam.votingEnd)}` : null
    default: return `Closed ${fmt(jam.votingEnd ?? jam.end)}`
  }
}

/** Pretty-print a raw event, expanding any JSON-encoded tag values. */
function readableEventJson(ev: Record<string, unknown>): string {
  const out = { ...ev }
  if (Array.isArray(out.tags)) {
    out.tags = (out.tags as unknown[]).map((tag) =>
      Array.isArray(tag)
        ? tag.map((el) => {
            if (typeof el === 'string') {
              const t = el.trim()
              if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
                try { return JSON.parse(t) } catch { /* leave as string */ }
              }
            }
            return el
          })
        : tag,
    )
  }
  return JSON.stringify(out, null, 2)
}

function InfoRow({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-neutral-400">{label}</span>
      <span className={cn('text-right font-medium', active ? 'text-[#fc4462]' : 'text-neutral-200')}>{value}</span>
    </div>
  )
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-xl border border-[#262626] bg-[#1c1c1c] p-4">
    <h2 className="text-lg font-semibold text-white">{title}</h2>
    {children}
  </section>
)

/** A collapsible headline + body row, used for both rules and FAQ entries. */
function DisclosureItem({ heading, body }: { heading: string; body: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-[#262626] bg-[#212121]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-medium text-neutral-200">
        {heading}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-neutral-500 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
        <div className="overflow-hidden">
          <p className="whitespace-pre-wrap px-3 pb-3 text-sm text-neutral-400">{body}</p>
        </div>
      </div>
    </div>
  )
}

export function JamPage() {
  const { naddr } = useParams<{ naddr: string }>()
  const navigate = useNavigate()
  const myPubkey = useAuthStore((s) => s.pubkey)
  const now = useNow()
  const [jam, setJam] = useState<JamDetails | null>(null)
  const [rawEvent, setRawEvent] = useState<NostrEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [choices, setChoices] = useState<NostrEvent[]>([])
  const [deleted, setDeleted] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [tallyOpen, setTallyOpen] = useState(false)
  const [showRawDialog, setShowRawDialog] = useState(false)
  const [readableRaw, setReadableRaw] = useState(false)
  const [newerEvent, setNewerEvent] = useState<NostrEvent | null>(null)

  // Show the short address in the URL bar once this jam has one.
  useShortUrl(rawEvent, '/mod-jam')

  const rawJson = useMemo(
    () => (rawEvent ? (readableRaw ? readableEventJson(rawEvent as unknown as Record<string, unknown>) : JSON.stringify(rawEvent, null, 2)) : ''),
    [rawEvent, readableRaw],
  )

  // Render a fetched event into page state (initial or refresh).
  const applyEvent = useCallback((ev: NostrEvent) => {
    // A tombstoned jam keeps only its d/published_at tags, so extractJam would
    // just see it as malformed — check the marker first to report it properly.
    if (isDeleted(ev)) { setDeleted(true); setLoading(false); return }
    const j = extractJam(ev)
    // Mod client: only mod jams render here. Any non-mod jam (same kind) is
    // treated as not found, matching its absence from the listing.
    if (!j || !isModJam(j)) { setNotFound(true); setLoading(false); return }
    setJam(j); setRawEvent(ev); setLoading(false)
  }, [])

  useEffect(() => {
    if (!naddr) return
    let cancelled = false

    async function load() {
      setNotFound(false); setNewerEvent(null)
      // The param is an naddr, or a NIP-SHORT address once the URL has been
      // rewritten — a reload lands here with the short form.
      const relaysForDecode = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const decoded = await decodePostParam(naddr!, relaysForDecode)
      if (cancelled) return
      if (decoded && 'candidates' in decoded) { setChoices(decoded.candidates); setLoading(false); return }
      if (!decoded || decoded.kind !== KINDS.JAM) { setNotFound(true); setLoading(false); return }
      const { pubkey, identifier, event: resolved } = decoded
      const coord = `${KINDS.JAM}:${pubkey}:${identifier}`
      if (resolved) applyEvent(resolved)

      // 1. Instant render from the shared cache (a prior list fetch or session).
      await whenEventCacheReady
      if (cancelled) return
      const cached = getCachedEvent(coord)
      if (cached) applyEvent(cached)
      else setLoading(true)

      // 2. Background re-fetch to catch a newer revision. With a cached copy shown,
      // use the high-assurance multi-pass fetch; on a cold view, the fast one.
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const filter = { kinds: [KINDS.JAM], authors: [pubkey], '#d': [identifier] }
        const ev = cached ? await fetchLatestEvent(relays, filter) : await fetchEvent(relays, filter)
        if (cancelled) return
        if (!ev) { if (!cached) { setNotFound(true); setLoading(false) } return }
        if (!cached) applyEvent(ev)
        else if (ev.created_at > cached.created_at) setNewerEvent(ev) // prompt, don't force
      } catch {
        if (!cancelled && !cached) { setNotFound(true); setLoading(false) }
      }
    }

    load()
    return () => { cancelled = true }
  }, [naddr, applyEvent])

  // Cooperative rebroadcast: a few seconds in, help keep the jam replicated.
  useEffect(() => {
    if (!rawEvent) return
    const t = setTimeout(() => {
      import('@/lib/nostr/eventRedundancy').then(({ ensureEventPresent }) => ensureEventPresent(rawEvent))
    }, 8000)
    return () => clearTimeout(t)
  }, [rawEvent])

  if (deleted) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Trash2 className="h-12 w-12 text-red-400" />
        <h2 className="text-xl font-semibold text-neutral-200">Mod jam deleted</h2>
        <p className="text-sm text-neutral-400">This mod jam has been permanently deleted.</p>
        <Button variant="outline" onClick={() => navigate('/mod-jams')}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to Mod Jams
        </Button>
      </div>
    )
  }
  // An ambiguous short address: nothing to show until the reader picks.
  if (choices.length > 0) {
    return (
      <ShortAddressChooser
        open
        onOpenChange={(o) => { if (!o) { setChoices([]); setNotFound(true) } }}
        candidates={choices}
        renderPreview={postPreview}
        onChoose={(ev) => {
          const suffix = selectorFor(ev, choices)
          if (suffix && naddr) window.history.replaceState(null, '', `/mod-jam/${naddr}-${suffix}`)
          setChoices([])
          applyEvent(ev)
        }}
      />
    )
  }

  if (loading) return <div className="flex items-center justify-center py-24 text-neutral-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading jam…</div>
  if (notFound || !jam) return <div className="py-24 text-center text-neutral-400">Mod jam not found.</div>

  const status = jamStatus(jam, now)
  const target: NostrTarget = { id: jam.id, pubkey: jam.pubkey, kind: KINDS.JAM, aTag: jam.aTag }
  const hasWarning = !!jam.contentWarning && !revealed
  const isAuthor = myPubkey === jam.pubkey
  const canSubmit = status === 'active'
  const submitTip = status === 'upcoming' ? `Opens when the jam starts (${jamCountdownLabel(jam, now)})` : 'Submissions are closed'
  const hasVoting = jam.votingEnabled || jam.userVotingEnabled
  const votingOver = hasVoting && !!jam.votingEnd && now > jam.votingEnd

  const copyNaddr = () => { if (naddr) { navigator.clipboard.writeText(naddr); toast.success('Note ID copied to clipboard') } }
  const copyNpub = () => { navigator.clipboard.writeText(nip19.npubEncode(jam.pubkey)); toast.success('Author npub copied to clipboard') }
  const copyRawJson = () => { if (rawJson) { navigator.clipboard.writeText(rawJson); toast.success(readableRaw ? 'Readable JSON copied to clipboard' : 'Raw JSON copied to clipboard') } }

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
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[#fc4462]">
              <Gamepad2 className="h-4 w-4" />
              {jam.games.length === 0 ? <span>Any game</span> : jam.games.map((g) => <span key={g} className="rounded-md bg-[#fc4462]/15 px-2 py-0.5">{g}</span>)}
            </div>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-3xl font-bold text-white">{jam.title}</h1>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="shrink-0 text-neutral-400 hover:bg-[#262626] hover:text-white">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="border-[#262626] bg-[#1c1c1c]">
                  <DropdownMenuItem onClick={copyNaddr} className="cursor-pointer"><Copy className="mr-2 h-4 w-4" /> Copy Note ID</DropdownMenuItem>
                  <DropdownMenuItem onClick={copyNpub} className="cursor-pointer"><Copy className="mr-2 h-4 w-4" /> Copy Author npub</DropdownMenuItem>
                  {rawEvent && <CopyShortLinkItem event={rawEvent} basePath="/mod-jam" />}
                  <DropdownMenuItem onClick={() => setShowRawDialog(true)} className="cursor-pointer"><FileJson className="mr-2 h-4 w-4" /> View Raw Event</DropdownMenuItem>
                  {isAuthor && (
                    <>
                      <DropdownMenuSeparator className="bg-[#262626]" />
                      <DropdownMenuItem onClick={() => navigate(`/mod-jam/${naddr}/edit`)} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" /> Edit jam</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowDeleteDialog(true)} className="cursor-pointer text-red-400 focus:text-red-400"><Trash2 className="mr-2 h-4 w-4" /> Request Delete</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* Always shown: an absent theme means "not announced yet", which is
                itself information entrants want. Hiding the row would read as
                "this jam has no theme" instead. */}
            <div className={cn(
              'flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border px-3.5 py-2.5',
              jam.theme ? 'border-[#fc4462]/40 bg-[#fc4462]/10' : 'border-[#262626] bg-[#212121]',
            )}>
              <span className={cn('text-xs font-semibold uppercase tracking-wide', jam.theme ? 'text-[#fc4462]' : 'text-neutral-500')}>Theme</span>
              {jam.theme
                ? <span className="text-lg font-semibold text-white">{jam.theme}</span>
                : <span className="text-lg font-semibold text-neutral-500">To be revealed</span>}
            </div>

            {/* Where the jam is in its life, full width. This was a pill floating
                over the cover image, which put the single most time-sensitive
                fact on the page behind an NSFW blur and easy to miss. */}
            <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border px-3.5 py-2.5', STATUS_BAND[status].box)}>
              <span className={cn('inline-flex items-center gap-2 text-sm font-semibold', STATUS_BAND[status].text)}>
                <span className={cn('h-2 w-2 rounded-full', STATUS_BAND[status].dot)} />
                {STATUS_BAND[status].label}
                {/* An ended jam's countdown label is just "Ended" — don't say it twice. */}
                {status !== 'ended' && (
                  <>
                    <span className="text-neutral-500">·</span>
                    <span className="inline-flex items-center gap-1 font-medium"><Clock className="h-3.5 w-3.5" /> {jamCountdownLabel(jam, now)}</span>
                  </>
                )}
              </span>
              {statusMilestone(jam, status) && (
                <span className="text-xs text-neutral-400">{statusMilestone(jam, status)}</span>
              )}
            </div>
          </div>

          {jam.content && <CollapsibleMarkdown content={jam.content} />}

          {jam.screenshots.length > 0 && (
            <Section title="Gallery"><ModScreenshots screenshots={jam.screenshots} blurred={hasWarning} onReveal={() => setRevealed(true)} /></Section>
          )}

          {/* Schedule */}
          <Section title="Schedule">
            <InfoRow label="Starts" value={fmt(jam.start)} active={status === 'upcoming'} />
            <InfoRow label="Submissions close" value={fmt(jam.end)} active={status === 'active'} />
            {jam.votingEnd && <InfoRow label="Voting ends" value={fmt(jam.votingEnd)} active={status === 'voting'} />}
            <p className="pt-1 text-[11px] text-neutral-500">Shown in your local time.</p>
          </Section>

          {/* Voting */}
          {(jam.votingEnabled || jam.userVotingEnabled) && (
            <Section title="Voting">
              <div className="flex flex-wrap gap-2 text-xs">
                {jam.votingEnabled && <span className="rounded-md bg-[#262626] px-2 py-1 text-neutral-200">Judge voting</span>}
                {jam.userVotingEnabled && <span className="rounded-md bg-[#262626] px-2 py-1 text-neutral-200">Community voting</span>}
              </div>
              {/* Judges' ballots are fetched and verified individually; community
                  votes are counted by relays, which can't be independently
                  checked. Without judges there's nothing authoritative to point
                  at, and the results shouldn't read as if there were. */}
              {!jam.votingEnabled && jam.userVotingEnabled && (
                <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  This jam has no judges, so its results are unofficial. Community votes are counted
                  by the vote relays rather than verified one by one, and can be undercounted or
                  inflated.
                </p>
              )}
              <div>
                <p className="mb-1.5 text-xs font-medium text-neutral-400">Scored on</p>
                <div className="flex flex-wrap gap-1.5">
                  {(jam.criteria.length ? jam.criteria.map((c) => `${c.label} (0–${c.max})`) : [`Overall (0–${jam.scoreMax})`]).map((c) => (
                    <span key={c} className="rounded-md border border-[#262626] px-2 py-1 text-xs text-neutral-300">{c}</span>
                  ))}
                </div>
              </div>
              {jam.votingEnabled && jam.judges.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-neutral-400"><Users className="h-3.5 w-3.5" /> Judges</p>
                  <div className="space-y-1.5">{jam.judges.map((j) => <JudgeRow key={j} value={j} locked />)}</div>
                </div>
              )}
            </Section>
          )}

          {/* Rewards */}
          {(jam.rewards.length > 0 || jam.rewardNote) && (
            <Section title="Rewards">
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

          {/* Rules */}
          {jam.rules.length > 0 && (
            <Section title="Rules">
              <div className="space-y-2">
                {jam.rules.map((r, i) => (
                  <DisclosureItem key={i} heading={r.title} body={r.detail} />
                ))}
              </div>
            </Section>
          )}

          {/* FAQ */}
          {jam.faq.length > 0 && (
            <Section title="FAQ">
              <div className="space-y-2">
                {jam.faq.map((f, i) => (
                  <DisclosureItem key={i} heading={f.question} body={f.answer} />
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <PublisherCard pubkey={jam.pubkey} />

          {/* Reactions + zaps */}
          <div className="flex flex-wrap items-center gap-2">
            <ReactionButton target={target} bucket="positive" />
            <ReactionButton target={target} content="💩" bucket="negative" icon={PoopIcon} />
            <ZapButton target={target} />
          </div>

          {/* Actions */}
          <TooltipProvider delayDuration={150}>
            <div className="space-y-2 rounded-xl border border-[#262626] bg-[#1c1c1c] p-3">
              {isAuthor && votingOver && (
                <Button variant="outline" className="w-full gap-2 border-[#fc4462]/40 text-[#fc4462] hover:bg-[#fc4462]/10" onClick={() => setTallyOpen(true)}>
                  <Scale className="h-4 w-4" /> {jam.resultsAt ? 'View results' : 'Tally votes'}
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
              {/* Always available: entries are public on relays anyway, so gating
                  this in the UI would only inconvenience honest visitors. */}
              <Button variant="outline" onClick={() => navigate(`/mod-jam/${naddr}/submissions`)} className="w-full gap-2 border-[#262626]">
                <ListOrdered className="h-4 w-4" /> Show submissions
              </Button>
            </div>
          </TooltipProvider>

          {/* Published */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-neutral-200">Published</h2>
            <p className="text-sm text-neutral-400">{fmtLong(jam.publishedAt)}</p>
            {jam.client && <p className="text-xs text-neutral-500">on {jam.client}</p>}
          </section>

          {naddr && <ShareBox url={`${window.location.origin}/mod-jam/${naddr}`} title={jam.title} />}
          <SidebarAd />
        </div>
      </div>

      {/* Comments — full width below both columns (so on mobile they sit at the bottom) */}
      <div className="mt-8">
        <CommentSection root={target} />
      </div>

      {tallyOpen && <JamTallyModal open={tallyOpen} onOpenChange={setTallyOpen} jam={jam} />}

      {/* Request-delete dialog (confirm + progress), same flow as a mod post */}
      {rawEvent && (
        <RequestDeleteDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          event={rawEvent as unknown as Parameters<typeof RequestDeleteDialog>[0]['event']}
          title={jam.title}
          noun="mod jam"
          onDeleted={() => { setDeleted(true); setShowDeleteDialog(false) }}
        />
      )}

      {/* Raw Event dialog */}
      <Dialog open={showRawDialog} onOpenChange={setShowRawDialog}>
        <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-neutral-100"><FileJson className="h-5 w-5 text-[#fc4462]" /> Raw Event</DialogTitle>
            <DialogDescription className="text-neutral-400">The raw Nostr event data for this mod jam.</DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-center justify-end gap-2">
            <span className="text-xs text-neutral-400">Readable</span>
            <Switch checked={readableRaw} onCheckedChange={setReadableRaw} />
          </label>
          <div className="flex-1 overflow-auto rounded-lg border border-[#262626] bg-[#171717] p-4">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-neutral-300"><code>{rawJson}</code></pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copyRawJson} className="border-[#262626]"><Copy className="mr-2 h-4 w-4" /> Copy JSON</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Newer version available — prompt instead of force-refreshing */}
      <Dialog open={!!newerEvent} onOpenChange={(o) => { if (!o) setNewerEvent(null) }}>
        <DialogContent className="border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Newer version available</DialogTitle>
            <DialogDescription className="text-neutral-400">This mod jam was updated since you opened it. Refresh to load the latest version.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewerEvent(null)} className="border-[#262626]">Dismiss</Button>
            <Button onClick={() => { if (newerEvent) applyEvent(newerEvent); setNewerEvent(null) }} className="bg-[#fc4462] text-white hover:bg-[#e23a56]"><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
