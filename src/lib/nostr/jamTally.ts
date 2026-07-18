/**
 * Tallying a jam.
 *
 * Two tracks, gathered in completely different ways because they scale
 * completely differently:
 *
 * - **Judges** — a bounded, known set of pubkeys, so their ballots are *fetched*
 *   as real events, validated whole, and averaged exactly. This is the
 *   authoritative track: anyone can re-fetch the same ballots and verify it.
 * - **Community** — unbounded. Never fetched. Relays are asked to *count* ballots
 *   per (criterion, score) bucket, so cost is fixed by the jam's shape rather
 *   than by how many people voted. Best-effort: counts can't be deduplicated
 *   across relays, so the highest answer for each bucket wins (a relay holds a
 *   subset, so its count is always a floor).
 *
 * See docs/jam-event.md.
 */
import { fetchEvents, countEvents } from '@/lib/nostr/relay-pool'
import { KINDS } from '@/lib/constants'
import { isValidSubmission, submissionWindow, JAM_ENTRY_LABEL, type JamDetails } from '@/lib/nostr/jam'
import { extractModData } from '@/lib/nostr/events'
import {
  extractBallot, isBallotCounted, judgeHexSet, ballotCriteria, scoreBuckets,
  emptyHistogram, histogramToTrack, aggregateResults,
  type JamBallot, type TrackAggregate, type EntryAggregate,
} from '@/lib/nostr/jamVoting'

/** Concurrent COUNT queries in flight. Enough to be quick, few enough not to trip rate limits. */
const COUNT_CONCURRENCY = 8

export interface EntryTally {
  coordinate: string
  judge: TrackAggregate
  community: TrackAggregate
  /** No relay answered a single count query — "we don't know", not "nobody voted". */
  communityUnknown: boolean
}

/** The jam's valid entries — newest per coordinate, bounded to the submission window. */
export async function fetchEntries(relays: string[], jam: JamDetails) {
  const w = submissionWindow(jam)
  const events = await fetchEvents(relays, {
    kinds: [KINDS.MOD], '#l': [JAM_ENTRY_LABEL], '#a': [jam.aTag], since: w.since, until: w.until,
  })
  const byCoord = new Map<string, typeof events[number]>()
  for (const ev of events) {
    const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    const key = `${ev.pubkey}:${d}`
    const cur = byCoord.get(key)
    if (!cur || ev.created_at > cur.created_at) byCoord.set(key, ev)
  }
  return [...byCoord.values()]
    .filter((ev) => !ev.tags.some((t) => t[0] === 'deleted' && t[1] === 'true'))
    .filter((ev) => isValidSubmission(ev, jam))
    .map(extractModData)
}

/**
 * Every judge ballot for the jam, validated.
 *
 * Bounded by the judge list, so this is a single filtered fetch no matter how
 * large the jam got. Returns null when the jam has no self-verifiable judges
 * (names rather than npubs) — an author filter can't be built from a name.
 */
export async function fetchJudgeBallots(relays: string[], jam: JamDetails): Promise<JamBallot[] | null> {
  const judges = [...judgeHexSet(jam.judges)]
  if (judges.length === 0) return null
  const events = await fetchEvents(relays, {
    kinds: [KINDS.JAM_BALLOT], '#a': [jam.aTag], authors: judges,
    since: jam.end, until: jam.votingEnd ?? jam.end,
  })
  // Newest per (voter, entry); a ballot is replaceable within the window.
  const newest = new Map<string, typeof events[number]>()
  for (const ev of events) {
    const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    const key = `${ev.pubkey}:${d}`
    const cur = newest.get(key)
    if (!cur || ev.created_at > cur.created_at) newest.set(key, ev)
  }
  return [...newest.values()]
    .filter((ev) => isBallotCounted(ev, jam))
    .map(extractBallot)
    .filter((b): b is JamBallot => !!b)
}

/**
 * Count one entry's community ballots into a histogram.
 *
 * `criteria × (max + 1)` small queries, run with bounded concurrency. A bucket no
 * relay answers stays 0 and is reported through `unknown` so a relay outage can
 * be told apart from a genuine shutout.
 */
export async function countEntryHistogram(
  relays: string[],
  jam: JamDetails,
  entryCoordinate: string,
  onProgress?: () => void,
): Promise<{ hist: number[][]; answered: number; asked: number }> {
  const buckets = scoreBuckets(jam)
  const hist = emptyHistogram(jam)
  let answered = 0
  let cursor = 0

  const worker = async () => {
    for (;;) {
      const i = cursor++
      if (i >= buckets.length) return
      const b = buckets[i]
      try {
        const n = await countEvents(relays, {
          kinds: [KINDS.JAM_BALLOT],
          '#a': [entryCoordinate],
          '#c': [b.bucket],
          since: jam.end,
          until: jam.votingEnd ?? jam.end,
        })
        // countEvents already takes the highest answer across relays and returns
        // 0 when none replied, so a 0 here is "nobody answered or nobody voted".
        if (n > 0) { hist[b.index][b.value] = n; answered++ }
      } catch {
        /* leave the bucket at 0 — reported via `answered` */
      }
      onProgress?.()
    }
  }

  await Promise.all(Array.from({ length: Math.min(COUNT_CONCURRENCY, buckets.length) }, worker))
  return { hist, answered, asked: buckets.length }
}

/** Judge + community results for a single entry, for the on-demand view. */
export async function tallyEntry(relays: string[], jam: JamDetails, entryCoordinate: string): Promise<EntryTally> {
  const criteriaCount = ballotCriteria(jam).length
  const [judgeBallots, counted] = await Promise.all([
    jam.votingEnabled ? fetchJudgeBallots(relays, jam) : Promise.resolve(null),
    jam.userVotingEnabled ? countEntryHistogram(relays, jam, entryCoordinate) : Promise.resolve(null),
  ])

  const forEntry = (judgeBallots ?? []).filter((b) => b.submissionCoordinate === entryCoordinate)
  const judgeAgg = aggregateResults([entryCoordinate], forEntry, judgeHexSet(jam.judges), criteriaCount)[0]

  return {
    coordinate: entryCoordinate,
    judge: judgeAgg.judge,
    community: counted ? histogramToTrack(counted.hist) : { avg: 0, votes: 0, perCriterion: [] },
    // Every bucket came back empty — indistinguishable from "no relay answered",
    // so say so rather than rendering a confident zero.
    communityUnknown: !!counted && counted.answered === 0,
  }
}

export interface FullTally {
  entries: { coordinate: string; title: string }[]
  aggregates: EntryAggregate[]
  judgeBallots: number
  /** True when judge voting is on but no judge is listed as an npub. */
  judgesUnverifiable: boolean
  communityAnswered: number
  communityAsked: number
}

/**
 * Tally the whole jam: judges fetched once, community counted per entry.
 *
 * `onProgress` fires per completed count query so a large jam can show real
 * movement — total work is entries × criteria × (max + 1), known up front, which
 * is the point of counting instead of sweeping.
 */
export async function tallyJam(
  relays: string[],
  jam: JamDetails,
  onProgress?: (done: number, total: number) => void,
): Promise<FullTally> {
  const criteria = ballotCriteria(jam)
  const criteriaCount = criteria.length
  const entries = await fetchEntries(relays, jam)
  const coordinates = entries.map((m) => m.aTag)

  const judgeBallots = jam.votingEnabled ? await fetchJudgeBallots(relays, jam) : null
  const judgesUnverifiable = !!jam.votingEnabled && judgeBallots === null

  // Judge track: exact, from real events.
  const aggregates = aggregateResults(coordinates, judgeBallots ?? [], judgeHexSet(jam.judges), criteriaCount)

  // Community track: counted per entry, overwriting the (empty) user track above.
  let done = 0
  let communityAnswered = 0
  let communityAsked = 0
  if (jam.userVotingEnabled) {
    const total = coordinates.length * scoreBuckets(jam).length
    onProgress?.(0, total)
    for (const agg of aggregates) {
      const { hist, answered, asked } = await countEntryHistogram(relays, jam, agg.coordinate, () => {
        onProgress?.(++done, total)
      })
      communityAnswered += answered
      communityAsked += asked
      agg.user = histogramToTrack(hist)
    }
    // Ranks were assigned against an empty community track — redo that one.
    rerankUser(aggregates)
  }

  return {
    entries: entries.map((m) => ({ coordinate: m.aTag, title: m.title })),
    aggregates,
    judgeBallots: (judgeBallots ?? []).length,
    judgesUnverifiable,
    communityAnswered,
    communityAsked,
  }
}

/** Re-assign the community rank after counting replaced that track. */
function rerankUser(aggregates: EntryAggregate[]) {
  const ranked = [...aggregates]
    .filter((a) => a.user.votes > 0)
    .sort((a, b) => b.user.avg - a.user.avg || b.user.votes - a.user.votes)
  for (const a of aggregates) a.uRank = 0
  ranked.forEach((a, i) => { a.uRank = i + 1 })
}
