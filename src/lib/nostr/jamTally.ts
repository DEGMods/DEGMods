/**
 * Tallying a jam.
 *
 * One track: the judges. They're a bounded, known set of pubkeys, so their
 * ballots are *fetched* as real events, validated whole, and averaged exactly —
 * anyone can re-fetch the same ballots and get the same answer.
 *
 * There is deliberately no open community vote. Counting one on Nostr means
 * either downloading an unbounded number of ballots or asking relays to count
 * them (NIP-45, which ~5% of relays implement and which can't be deduplicated
 * across relays). Both are impractical, and neither fixes the real problem: keys
 * are free, so an open vote measures who scripted it. See docs/jam-event.md.
 */
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { KINDS } from '@/lib/constants'
import { isValidSubmission, submissionWindow, JAM_ENTRY_LABEL, type JamDetails } from '@/lib/nostr/jam'
import { extractModData } from '@/lib/nostr/events'
import {
  extractBallot, isBallotCounted, judgeHexSet, ballotCriteria, aggregateResults,
  type JamBallot, type TrackAggregate, type EntryAggregate,
} from '@/lib/nostr/jamVoting'

export interface EntryTally {
  coordinate: string
  judge: TrackAggregate
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


/** One entry's judge result, for the on-demand view. One fetch. */
export async function tallyEntry(relays: string[], jam: JamDetails, entryCoordinate: string): Promise<EntryTally> {
  const criteriaCount = ballotCriteria(jam).length
  const judgeBallots = jam.votingEnabled ? await fetchJudgeBallots(relays, jam) : null

  const forEntry = (judgeBallots ?? []).filter((b) => b.submissionCoordinate === entryCoordinate)
  const judgeAgg = aggregateResults([entryCoordinate], forEntry, judgeHexSet(jam.judges), criteriaCount)[0]

  return { coordinate: entryCoordinate, judge: judgeAgg.judge }
}

export interface FullTally {
  entries: { coordinate: string; title: string }[]
  aggregates: EntryAggregate[]
  judgeBallots: number
  /** True when judge voting is on but no judge is listed as an npub. */
  judgesUnverifiable: boolean
}

/**
 * Tally the whole jam.
 *
 * Judges are a known, bounded set of pubkeys, so their ballots are fetched as
 * real events and counted exactly — one query for the whole jam, regardless of
 * how many entries or judges there are. There is no community track: see
 * docs/jam-event.md for why an open vote isn't counted here.
 */
export async function tallyJam(relays: string[], jam: JamDetails): Promise<FullTally> {
  const criteriaCount = ballotCriteria(jam).length
  const entries = await fetchEntries(relays, jam)
  const coordinates = entries.map((m) => m.aTag)

  const judgeBallots = jam.votingEnabled ? await fetchJudgeBallots(relays, jam) : null
  const judgesUnverifiable = !!jam.votingEnabled && judgeBallots === null

  const aggregates = aggregateResults(coordinates, judgeBallots ?? [], judgeHexSet(jam.judges), criteriaCount)

  return {
    entries: entries.map((m) => ({ coordinate: m.aTag, title: m.title })),
    aggregates,
    judgeBallots: (judgeBallots ?? []).length,
    judgesUnverifiable,
  }
}

