import { useEffect, useState } from 'react'
import { useNsfwReveal } from '@/hooks/useNsfwReveal'
import { Link } from 'react-router-dom'
import { Vote, Eye, Medal, Loader2, AlertCircle, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/useNow'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchLatestEvent, fetchEvents } from '@/lib/nostr/relay-pool'
import { getCachedEvent, whenEventCacheReady } from '@/lib/nostr/eventCache'
import { extractJam, jamStatus, type JamDetails } from '@/lib/nostr/jam'
import { isDeleted } from '@/lib/nostr/events'
import {
  extractBallot, ballotDTag, judgeHexSet, latestResults, rowsForEntry,
  type JamBallot, type JamResultRow,
} from '@/lib/nostr/jamVoting'
import { KINDS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { JamVoteModal } from './JamVoteModal'
import { EntryScoresPanel } from './EntryScoresPanel'

/**
 * Shown on a mod post that is a jam entry: links back to the jam, shows the
 * entry's rank once results are published, and (within the voting window) opens
 * the scoring modal for eligible voters.
 */
export function ModJamBanner({
  jamCoordinate,
  submissionCoordinate,
  submissionDTag,
  submissionTitle,
}: {
  jamCoordinate: string
  submissionCoordinate: string
  submissionDTag: string
  submissionTitle: string
}) {
  const now = useNow(30000)
  const myPubkey = useAuthStore((s) => s.pubkey)

  const [jam, setJam] = useState<JamDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [ballot, setBallot] = useState<JamBallot | null>(null)
  // Which (jam, entry, voter) the current `ballot` value is an answer for. While
  // this doesn't match the current one, we haven't checked yet — derived rather
  // than a loading flag so there's no first-render frame claiming "not voted".
  const [checkedKey, setCheckedKey] = useState<string | null>(null)
  const [rank, setRank] = useState<{ judge: JamResultRow | null; community: JamResultRow | null } | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const { revealed, reveal } = useNsfwReveal()
  const [jamDeleted, setJamDeleted] = useState(false)

  // Load the jam (window, criteria, judges, relays).
  useEffect(() => {
    let cancelled = false
    const parts = jamCoordinate.split(':')
    if (parts.length < 3) { setLoading(false); return }
    const pubkey = parts[1]
    const identifier = parts.slice(2).join(':')

    ;(async () => {
      setLoading(true)
      // Instant when the jam is already cached (e.g. seen in a listing).
      await whenEventCacheReady
      if (cancelled) return
      const cached = getCachedEvent(jamCoordinate)
      if (cached && isDeleted(cached)) { setJamDeleted(true); setLoading(false) }
      const cachedJam = cached && !isDeleted(cached) ? extractJam(cached) : null
      if (cachedJam) { setJam(cachedJam); setLoading(false) }

      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const ev = await fetchLatestEvent(relays, { kinds: [KINDS.JAM], authors: [pubkey], '#d': [identifier] })
        if (cancelled) return
        // A tombstoned jam keeps only its d/published_at tags, so extractJam sees
        // it as malformed — check the marker so we can say it was deleted.
        if (ev && isDeleted(ev)) { setJamDeleted(true); setJam(null); return }
        const fresh = ev ? extractJam(ev) : null
        if (fresh) { setJam(fresh); setJamDeleted(false) }
      } catch {
        /* keep the cached copy if we have one; otherwise the not-found state shows */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [jamCoordinate])

  // Load the published results (if any) to show this entry's rank.
  useEffect(() => {
    let cancelled = false
    if (!jam) return
    const relays = [...new Set([...useSettingsStore.getState().getAllEnabledRelayUrls('read'), ...jam.relays])]
    fetchEvents(relays, { kinds: [KINDS.JAM_RESULT], authors: [jam.pubkey], '#a': [jamCoordinate] })
      .then((events) => {
        if (cancelled) return
        const results = latestResults(events)
        setRank(results ? rowsForEntry(results, submissionCoordinate) : null)
      })
      .catch(() => { /* no results yet */ })
    return () => { cancelled = true }
  }, [jam, jamCoordinate, submissionCoordinate])

  // Load my existing ballot for this entry. Until this resolves we don't know
  // whether the user has voted, so the button stays in a checking state rather
  // than claiming "Vote on it" and then flipping to "View your vote".
  useEffect(() => {
    let cancelled = false
    if (!jam || !myPubkey) { setBallot(null); setCheckedKey(null); return }
    const relays = [...new Set([...useSettingsStore.getState().getAllEnabledRelayUrls('read'), ...jam.relays])]
    fetchLatestEvent(relays, {
      kinds: [KINDS.JAM_BALLOT],
      authors: [myPubkey],
      '#d': [ballotDTag(jam.dTag, submissionDTag)],
    })
      .then((ev) => { if (!cancelled) setBallot(ev ? extractBallot(ev) : null) })
      .catch(() => { /* ignore — treated as "no ballot found" */ })
      .finally(() => { if (!cancelled) setCheckedKey(`${jam.dTag}:${submissionDTag}:${myPubkey}`) })
    return () => { cancelled = true }
  }, [jam, myPubkey, submissionDTag])

  // The card holds its place (heading + image slot) while the jam resolves, so
  // the sidebar doesn't reflow once it lands.
  const shell = 'space-y-3 rounded-xl border border-[#fc4462]/30 bg-[#fc4462]/10 p-3'
  const heading = <p className="text-xs font-medium text-[#fc9db0]">This is an entry for a mod jam event</p>
  if (!jam) {
    if (loading) {
      return (
        <div className={shell}>
          {heading}
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )
    }
    // Deleted or simply unreachable — either way there's no jam to show, so say
    // what we know and stop there (no image, title, rank or vote button).
    return (
      <div className="space-y-2 rounded-xl border border-[#262626] bg-[#1c1c1c] p-3">
        <p className="text-xs font-medium text-neutral-500">Mod jam entry</p>
        <span className="flex items-start gap-2 text-sm text-neutral-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
          {jamDeleted
            ? 'This mod was entered into a mod jam that has since been deleted.'
            : 'This mod may have been an entry in a mod jam, but the jam couldn’t be found on your relays.'}
        </span>
      </div>
    )
  }

  const hasVoting = jam.votingEnabled || jam.userVotingEnabled
  const hasWarning = !!jam.contentWarning && !revealed
  const status = jamStatus(jam, now)
  const inWindow = !!jam.votingEnd && now >= jam.end && now <= jam.votingEnd
  const isJudge = !!myPubkey && judgeHexSet(jam.judges).has(myPubkey)
  const eligible = jam.userVotingEnabled || (jam.votingEnabled && isJudge)
  // Signed in but we haven't confirmed whether they've already voted on this entry.
  const ballotChecking = !!myPubkey && checkedKey !== `${jam.dTag}:${submissionDTag}:${myPubkey}`
  // A ballot cast outside [end, voting_end] doesn't count. Treat it as "not voted"
  // so the voter can re-cast (ballots are replaceable) rather than being shown a
  // vote that will be silently discarded at tally time.
  const ballotCounts = !!ballot && !!jam.votingEnd && ballot.createdAt >= jam.end && ballot.createdAt <= jam.votingEnd
  const staleBallot = !!ballot && !ballotCounts

  // Vote button state → { label, disabled, reason }.
  let voteBtn: { label: string; disabled: boolean; reason?: string; icon: typeof Vote; spinning?: boolean } | null = null
  if (hasVoting) {
    if (ballotChecking) {
      // Unknown yet — never offer "Vote on it" to someone who already voted.
      voteBtn = { label: 'Checking your vote…', disabled: true, icon: Loader2, spinning: true }
    } else if (ballotCounts) {
      voteBtn = { label: 'View your vote', disabled: false, icon: Eye }
    } else if (status === 'upcoming' || status === 'active') {
      // Window checks come before the signed-out check: a closed jam is closed to
      // everyone, and offering a signed-out visitor a live button only to disable
      // it the moment they log in is a worse trip through the login modal.
      voteBtn = { label: isJudge ? 'Judge it' : 'Vote on it', disabled: true, reason: 'Voting opens when submissions close.', icon: Vote }
    } else if (!inWindow) {
      voteBtn = { label: isJudge ? 'Judge it' : 'Vote on it', disabled: true, reason: 'Voting has ended.', icon: Vote }
    } else if (!myPubkey) {
      voteBtn = { label: isJudge ? 'Judge it' : 'Vote on it', disabled: false, icon: Vote }
    } else if (!eligible) {
      voteBtn = { label: 'Judges only', disabled: true, reason: 'Only the jam’s judges can score entries.', icon: Vote }
    } else {
      voteBtn = { label: isJudge ? 'Judge it' : 'Vote on it', disabled: false, icon: Vote }
    }
  }

  const onVoteClick = () => {
    if (!myPubkey) { useLoginModalStore.getState().open(); return }
    setModalOpen(true)
  }

  const naddr = jam.naddr
  const VoteIcon = voteBtn?.icon ?? Vote

  return (
    <TooltipProvider>
      <div className={shell}>
        {heading}

        <div className="group space-y-2">
          <div className="relative aspect-video overflow-hidden rounded-lg border border-[#262626] bg-[#171717]">
            {jam.image ? (
              <SkeletonImage
                src={jam.image}
                alt={jam.title}
                className={cn('h-full w-full object-cover', hasWarning && 'blur-lg')}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-neutral-600">No image</div>
            )}
            {hasWarning ? (
              // First click reveals (doesn't navigate), like a mod card — otherwise
              // opening the jam would show the image you chose not to see yet.
              <button
                onClick={() => reveal()}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-black/60 text-neutral-300"
              >
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                <span className="px-3 text-center text-[11px] font-medium">{jam.contentWarning}</span>
                <span className="text-[10px] text-neutral-500">Click to reveal</span>
              </button>
            ) : (
              <Link to={`/mod-jam/${naddr}`} className="absolute inset-0" aria-label={jam.title} />
            )}
          </div>
          <Link to={`/mod-jam/${naddr}`} className="line-clamp-2 block text-sm font-semibold text-white transition-colors group-hover:text-[#fc4462]">
            {jam.title}
          </Link>
        </div>

        {/* Rank pills once results are published. Judges first — that track is
            the official one; the community pill is an audience signal. */}
        {rank && (rank.judge || rank.community) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {jam.votingEnabled && rank.judge && (
              <span className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5',
                rank.judge.r === 1 ? 'bg-amber-400/20 font-semibold text-amber-200' : 'bg-black/30 text-amber-300',
              )}>
                <Medal className="h-3 w-3" />
                {rank.judge.r === 1 ? 'Winner' : `Judges’ #${rank.judge.r}`} · {rank.judge.s.toFixed(1)} avg
              </span>
            )}
            {jam.userVotingEnabled && rank.community && (
              <span className="inline-flex items-center gap-1 rounded-md bg-black/30 px-1.5 py-0.5 text-sky-300"><Medal className="h-3 w-3" /> Community #{rank.community.r} · {rank.community.s.toFixed(1)} avg</span>
            )}
          </div>
        )}

        {/* Only the top 100 of each track is published, and nothing at all before
            the tally runs — so every entry keeps a route to its own numbers. */}
        {(jam.votingEnabled || jam.userVotingEnabled) && now >= jam.end && (
          <EntryScoresPanel jam={jam} entryCoordinate={submissionCoordinate} />
        )}

        {staleBallot && !ballotChecking && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-400/90">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            You scored this entry before voting opened, so that vote won’t be counted.
            {inWindow ? ' Vote again to have it count.' : ''}
          </p>
        )}

        {voteBtn && (() => {
          const button = (
            <Button
              size="sm"
              disabled={voteBtn.disabled}
              onClick={voteBtn.disabled ? undefined : onVoteClick}
              className={cn(
                'w-full gap-1.5 text-xs text-white',
                voteBtn.disabled ? 'bg-[#fc4462]/40' : 'bg-[#fc4462] hover:bg-[#e23a56]',
              )}
            >
              <VoteIcon className={cn('h-3.5 w-3.5', voteBtn.spinning && 'animate-spin')} /> {voteBtn.label}
            </Button>
          )
          // Only wrap in a tooltip when there's a reason to explain — the
          // checking state already says what it's doing.
          return voteBtn.reason ? (
            <Tooltip>
              <TooltipTrigger asChild><span className="block">{button}</span></TooltipTrigger>
              <TooltipContent>{voteBtn.reason}</TooltipContent>
            </Tooltip>
          ) : button
        })()}
      </div>

      {modalOpen && (
        <JamVoteModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          jam={jam}
          submissionCoordinate={submissionCoordinate}
          submissionDTag={submissionDTag}
          submissionTitle={submissionTitle}
          existingBallot={ballot}
          readOnly={ballotCounts}
          onVoted={(b) => setBallot(b)}
        />
      )}
    </TooltipProvider>
  )
}
