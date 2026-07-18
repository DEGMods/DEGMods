import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Vote, Eye, Medal, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/useNow'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchLatestEvent, fetchEvents } from '@/lib/nostr/relay-pool'
import { getCachedEvent, whenEventCacheReady } from '@/lib/nostr/eventCache'
import { extractJam, jamStatus, type JamDetails } from '@/lib/nostr/jam'
import {
  extractBallot, ballotDTag, judgeHexSet, mergeResultPages,
  type JamBallot, type JamResultRow,
} from '@/lib/nostr/jamVoting'
import { KINDS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { JamVoteModal } from './JamVoteModal'

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
  const [rank, setRank] = useState<JamResultRow | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

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
      const cachedJam = cached ? extractJam(cached) : null
      if (cachedJam) { setJam(cachedJam); setLoading(false) }

      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const ev = await fetchLatestEvent(relays, { kinds: [KINDS.JAM], authors: [pubkey], '#d': [identifier] })
        if (cancelled) return
        const fresh = ev ? extractJam(ev) : null
        if (fresh) setJam(fresh)
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
        const rows = mergeResultPages(events)
        setRank(rows.get(submissionCoordinate) ?? null)
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

  // The section holds its place while the jam resolves, so the mod page doesn't
  // reflow once it lands.
  const shell = 'space-y-2 rounded-lg border border-[#fc4462]/30 bg-[#fc4462]/10 px-3 py-2.5'
  if (!jam) {
    return loading ? (
      <div className={shell}>
        <span className="flex items-center gap-2 text-sm text-[#fc9db0]">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#fc4462]" />
          Loading the mod jam this entry belongs to…
        </span>
      </div>
    ) : (
      <div className="space-y-2 rounded-lg border border-[#262626] bg-[#1c1c1c] px-3 py-2.5">
        <span className="flex items-center gap-2 text-sm text-neutral-400">
          <AlertCircle className="h-4 w-4 shrink-0 text-neutral-500" />
          This mod is an entry in a mod jam that couldn’t be found on your relays.
        </span>
      </div>
    )
  }

  const hasVoting = jam.votingEnabled || jam.userVotingEnabled
  const status = jamStatus(jam, now)
  const inWindow = !!jam.votingEnd && now >= jam.end && now <= jam.votingEnd
  const isJudge = !!myPubkey && judgeHexSet(jam.judges).has(myPubkey)
  const eligible = jam.userVotingEnabled || (jam.votingEnabled && isJudge)
  // Signed in but we haven't confirmed whether they've already voted on this entry.
  const ballotChecking = !!myPubkey && checkedKey !== `${jam.dTag}:${submissionDTag}:${myPubkey}`

  // Vote button state → { label, disabled, reason }.
  let voteBtn: { label: string; disabled: boolean; reason?: string; icon: typeof Vote; spinning?: boolean } | null = null
  if (hasVoting) {
    if (ballotChecking) {
      // Unknown yet — never offer "Vote on it" to someone who already voted.
      voteBtn = { label: 'Checking your vote…', disabled: true, icon: Loader2, spinning: true }
    } else if (ballot) {
      voteBtn = { label: 'View your vote', disabled: false, icon: Eye }
    } else if (!myPubkey) {
      voteBtn = { label: isJudge ? 'Judge it' : 'Vote on it', disabled: false, icon: Vote }
    } else if (!eligible) {
      voteBtn = { label: 'Judges only', disabled: true, reason: 'Only the jam’s judges can score entries.', icon: Vote }
    } else if (status === 'upcoming' || status === 'active') {
      voteBtn = { label: isJudge ? 'Judge it' : 'Vote on it', disabled: true, reason: 'Voting opens when submissions close.', icon: Vote }
    } else if (!inWindow) {
      voteBtn = { label: isJudge ? 'Judge it' : 'Vote on it', disabled: true, reason: 'Voting has ended.', icon: Vote }
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
        <Link to={`/mod-jam/${naddr}`} className="block min-w-0 text-sm text-[#fc9db0] hover:text-[#fc4462]">
          <span className="truncate">Entry in the <span className="font-medium text-white">{jam.title}</span> mod jam</span>
        </Link>

        {/* Rank pills once results are published */}
        {rank && (rank.jRank > 0 || rank.uRank > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {jam.votingEnabled && rank.jRank > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-black/30 px-1.5 py-0.5 text-amber-300"><Medal className="h-3 w-3" /> Judges’ #{rank.jRank} · {rank.judge.avg.toFixed(1)} avg</span>
            )}
            {jam.userVotingEnabled && rank.uRank > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-black/30 px-1.5 py-0.5 text-sky-300"><Medal className="h-3 w-3" /> Community #{rank.uRank} · {rank.user.avg.toFixed(1)} avg</span>
            )}
          </div>
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
          readOnly={!!ballot}
          onVoted={(b) => setBallot(b)}
        />
      )}
    </TooltipProvider>
  )
}
