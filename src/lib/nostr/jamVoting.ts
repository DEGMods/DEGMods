import type { Event as NostrEvent, UnsignedEvent } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { KINDS, CLIENT_NAME } from '@/lib/constants'
import type { JamCriterion, JamDetails } from '@/lib/nostr/jam'

// ─── Ballots (kind 31243) — see docs/jam-event.md ───────────────────

/** The single "overall" criterion used when a jam declares no custom criteria. */
export const OVERALL_CRITERION = 'overall'
export const OVERALL_MAX = 10

/**
 * One criterion's score. `index` is the criterion's position in the jam event —
 * that position, not the label, is what a ballot binds to. `criterion` is carried
 * for display only; a ballot whose label disagrees with the jam is not thereby
 * invalid (the fingerprint already guards real criteria changes).
 */
export interface JamScore { index: number; criterion: string; value: number }

export interface JamBallotFormState {
  jamCoordinate: string        // 31143:<jam-pk>:<jam-d>
  jamDTag: string
  submissionCoordinate: string // 31142:<mod-pk>:<mod-d>
  submissionDTag: string
  scores: JamScore[]
}

export interface JamBallot {
  id: string
  pubkey: string
  dTag: string
  createdAt: number
  jamCoordinate: string
  submissionCoordinate: string
  /** The criteria fingerprint this ballot was cast against (`"<n>x<max>:<hash>"`). */
  fingerprint: string
  scores: JamScore[]
  /** The event's content. The protocol allows a note here, but DEG Mods neither
   *  collects nor displays one — parsed only so a foreign client's isn't lost. */
  comment: string
}

/** Composite ballot d-tag: one ballot per (voter, jam, entry). */
export function ballotDTag(jamDTag: string, submissionDTag: string): string {
  return `${jamDTag}:${submissionDTag}`
}

/** The scoring criteria a ballot must fill for a jam (overall, or the custom set). */
export function ballotCriteria(jam: Pick<JamDetails, 'criteria' | 'scoreMax'>): JamCriterion[] {
  return jam.criteria.length ? jam.criteria : [{ label: OVERALL_CRITERION, max: jam.scoreMax || OVERALL_MAX }]
}

/**
 * Normalize a criterion label for fingerprinting.
 *
 * Only folds differences a *client* can introduce by re-serializing the jam —
 * Unicode form and whitespace. Case, dashes and quote styles are deliberately
 * left alone: no client rewrites those on its own, so a difference there means
 * a human retyped the label, which is exactly the change the fingerprint exists
 * to catch.
 */
function normalizeLabel(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/**
 * A jam's scoring shape, as it appears in every ballot's `c` tags: `"<n>x<max>:<hash>"`.
 *
 * The readable `<n>x<max>` prefix (criteria count × scale) makes a raw ballot
 * legible; the hash additionally covers the labels themselves. Together they mean
 * a ballot only counts toward the criteria set it was actually cast against —
 * change the criteria mid-voting and the buckets nobody queries go to zero, which
 * is loud and reversible, rather than silently misattributing scores to the wrong
 * criterion. See docs/jam-event.md.
 */
export function criteriaFingerprint(jam: Pick<JamDetails, 'criteria' | 'scoreMax'>): string {
  const criteria = ballotCriteria(jam)
  const max = criteria[0]?.max ?? OVERALL_MAX
  const payload = JSON.stringify([max, ...criteria.map((c) => normalizeLabel(c.label))])
  const hash = bytesToHex(sha256(new TextEncoder().encode(payload))).slice(0, 8)
  return `${criteria.length}x${max}:${hash}`
}

/** The indexed value of a `c` tag: `"<fingerprint>:<criterion index>:<score>"`. */
export function scoreBucket(fingerprint: string, index: number, value: number): string {
  return `${fingerprint}:${index}:${value}`
}

export function buildBallotEvent(form: JamBallotFormState, fingerprint: string): UnsignedEvent {
  // Ballots always stamp created_at = now (even on edit) so a post-deadline edit
  // self-invalidates. See docs/jam-event.md.
  const tags: string[][] = [
    ['d', ballotDTag(form.jamDTag, form.submissionDTag)],
    ['a', form.jamCoordinate],
    ['a', form.submissionCoordinate],
    // Single-letter so relays index it, and the score is packed into the *first*
    // value because filters only match on that — putting the bare score there
    // would collapse every criterion into one bucket.
    ...form.scores.map((s) => ['c', scoreBucket(fingerprint, s.index, s.value), s.criterion]),
    ['client', CLIENT_NAME],
  ]
  return {
    kind: KINDS.JAM_BALLOT,
    content: '', // no comment collected — a ballot is just its scores here
    tags,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

export function extractBallot(event: NostrEvent): JamBallot | null {
  if (event.kind !== KINDS.JAM_BALLOT) return null
  const aTags = event.tags.filter((t) => t[0] === 'a').map((t) => t[1])
  const jamCoordinate = aTags.find((a) => a?.startsWith(`${KINDS.JAM}:`)) ?? ''
  const submissionCoordinate = aTags.find((a) => a?.startsWith(`${KINDS.MOD}:`)) ?? ''
  if (!jamCoordinate || !submissionCoordinate) return null
  // "<n>x<max>:<hash>:<index>:<value>" — the fingerprint itself contains a colon,
  // so split from the right: the last two fields are index and value.
  const scores: JamScore[] = []
  let fingerprint = ''
  for (const t of event.tags) {
    if (t[0] !== 'c' || !t[1]) continue
    const parts = t[1].split(':')
    if (parts.length < 3) continue
    const value = Number(parts[parts.length - 1])
    const index = Number(parts[parts.length - 2])
    const fp = parts.slice(0, -2).join(':')
    if (!Number.isFinite(value) || !Number.isInteger(index) || index < 0) continue
    fingerprint = fingerprint || fp
    scores.push({ index, criterion: t[2] ?? '', value })
  }
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag: event.tags.find((t) => t[0] === 'd')?.[1] ?? '',
    createdAt: event.created_at,
    jamCoordinate,
    submissionCoordinate,
    fingerprint,
    scores,
    comment: event.content,
  }
}

/**
 * True if a ballot counts: cast inside the voting window, and scoring the jam's
 * criteria *exactly*.
 *
 * "Exactly" is deliberate — a ballot must carry one score per declared criterion,
 * with no extras, no duplicates, and every value within that criterion's range.
 * Anything else is dropped whole rather than partially counted, because partial
 * acceptance is gameable: an unknown label would otherwise open a bucket of its
 * own in the tally (unbounded, since it has no declared max), and a ballot that
 * skips criteria would be averaged over a smaller denominator than its rivals.
 * Dropping a ballot never aborts the tally — it just doesn't count.
 */
export function isBallotCounted(
  event: NostrEvent,
  jam: Pick<JamDetails, 'end' | 'votingEnd' | 'criteria' | 'scoreMax'>,
): boolean {
  if (!jam.votingEnd) return false
  if (event.created_at < jam.end || event.created_at > jam.votingEnd) return false
  const ballot = extractBallot(event)
  if (!ballot) return false

  // Cast against a different criteria set (renamed, reordered, added, removed, or
  // rescaled) — the scores no longer mean what this jam declares.
  if (ballot.fingerprint !== criteriaFingerprint(jam)) return false

  const criteria = ballotCriteria(jam)
  // Count first: catches extras, and (with the per-index lookup below) duplicates
  // — two scores for one criterion leave another unmatched.
  if (ballot.scores.length !== criteria.length) return false
  for (let i = 0; i < criteria.length; i++) {
    const score = ballot.scores.find((s) => s.index === i)
    if (!score) return false
    if (score.value < 0 || score.value > criteria[i].max) return false
  }
  return true
}

/** Hex pubkeys of the jam's judges (only npub-form entries are self-verifiable). */
/**
 * Is this judge entry something a ballot can actually be matched against?
 *
 * The editor blocks publishing anything else. Judges used to be free text, which
 * published happily and then quietly produced an empty judge track at tally time,
 * because a name has no pubkey to compare a ballot's author to.
 */
export function isJudgeKey(judge: string): boolean {
  const v = judge.trim()
  if (/^[0-9a-f]{64}$/i.test(v)) return true
  try {
    return nip19.decode(v).type === 'npub'
  } catch {
    return false
  }
}

export function judgeHexSet(judges: string[]): Set<string> {
  const out = new Set<string>()
  for (const j of judges) {
    const v = j.trim()
    try {
      const decoded = nip19.decode(v)
      if (decoded.type === 'npub') out.add(decoded.data)
    } catch {
      // a bare hex pubkey is also acceptable
      if (/^[0-9a-f]{64}$/i.test(v)) out.add(v.toLowerCase())
    }
  }
  return out
}

// ─── Aggregation & ranking ──────────────────────────────────────────

export interface TrackAggregate {
  avg: number              // mean of the per-criterion averages
  votes: number
  perCriterion: number[]   // average per criterion, in the jam's criterion order
}

export interface EntryAggregate {
  coordinate: string // 31142:<mod-pk>:<mod-d>
  judge: TrackAggregate
  jRank: number
}

function emptyTrack(n = 0): TrackAggregate { return { avg: 0, votes: 0, perCriterion: Array(n).fill(0) } }

/**
 * Average one track's ballots for one entry, per criterion + overall.
 *
 * Buckets by criterion *index*, which is only sound because every ballot reaching
 * here passed isBallotCounted — i.e. carries exactly the jam's declared criteria
 * under a matching fingerprint. Never feed this unvalidated ballots.
 */
function aggregateTrack(ballots: JamBallot[], criteriaCount: number): TrackAggregate {
  if (ballots.length === 0) return emptyTrack(criteriaCount)
  const totals = Array(criteriaCount).fill(0)
  const counts = Array(criteriaCount).fill(0)
  for (const b of ballots) {
    for (const s of b.scores) {
      if (s.index < 0 || s.index >= criteriaCount) continue
      totals[s.index] += s.value
      counts[s.index] += 1
    }
  }
  const perCriterion = totals.map((t, i) => (counts[i] ? t / counts[i] : 0))
  const scored = perCriterion.filter((_, i) => counts[i] > 0)
  const avg = scored.length ? scored.reduce((a, v) => a + v, 0) / scored.length : 0
  return { avg, votes: ballots.length, perCriterion }
}

/**
 * Aggregate all counted ballots into per-entry judge/user tracks and assign
 * both ranks. `entryCoordinates` seeds every valid entry so zero-vote entries
 * still appear (ranked last).
 */
export function aggregateResults(
  entryCoordinates: string[],
  countedBallots: JamBallot[],
  judgeHexes: Set<string>,
  criteriaCount: number,
): EntryAggregate[] {
  const byEntry = new Map<string, JamBallot[]>()
  for (const coord of entryCoordinates) byEntry.set(coord, [])
  for (const b of countedBallots) {
    if (!judgeHexes.has(b.pubkey)) continue // only judges vote
    byEntry.get(b.submissionCoordinate)?.push(b) // skips unknown/invalid entries
  }

  const aggregates: EntryAggregate[] = [...byEntry.entries()].map(([coordinate, judge]) => ({
    coordinate,
    judge: aggregateTrack(judge, criteriaCount),
    jRank: 0,
  }))

  assignRank(aggregates, 'judge', (a) => a.jRank, (a, r) => { a.jRank = r })
  return aggregates
}

/** Rank by avg desc, tie-broken by vote count desc. Zero-vote entries share the last rank 0. */
function assignRank(
  aggregates: EntryAggregate[],
  track: 'judge',
  _get: (a: EntryAggregate) => number,
  set: (a: EntryAggregate, rank: number) => void,
) {
  const ranked = [...aggregates]
    .filter((a) => a[track].votes > 0)
    .sort((a, b) => b[track].avg - a[track].avg || b[track].votes - a[track].votes)
  ranked.forEach((a, i) => set(a, i + 1))
  // entries with no votes keep rank 0 (unranked)
  for (const a of aggregates) if (a[track].votes === 0) set(a, 0)
}

// ─── Results (kind 31343) — one event, top N per track ──────────────

/** How many entries each track publishes. */
export const RESULT_TOP_N = 100

export interface JamResultRow {
  a: string    // entry coordinate 31142:<pk>:<d>
  r: number    // rank within this section
  v: number    // ballots counted in this track
  s: number    // aggregate score
  c: number[]  // per-criterion averages, in the jam's criterion order
}

export interface JamResults {
  judge: JamResultRow[]
  /** Top N published. Absence means "not in the top N", not "no votes". */
  truncatedAt: number
}

/** One decimal — ranks are precomputed, so display precision can't affect ordering. */
const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * The top N entries, ranked.
 *
 * Zero-vote entries are dropped rather than published as rank 0: a row of all
 * zeroes carries no information, and absence already says the same thing more
 * cheaply.
 */
export function trackRows(aggregates: EntryAggregate[], topN = RESULT_TOP_N): JamResultRow[] {
  return aggregates
    .filter((a) => a.judge.votes > 0)
    .sort((a, b) => a.jRank - b.jRank)
    .slice(0, topN)
    .map((a) => ({
      a: a.coordinate,
      r: a.jRank,
      v: a.judge.votes,
      s: round1(a.judge.avg),
      c: a.judge.perCriterion.map(round1),
    }))
}

export function buildResultEvent(
  jamCoordinate: string,
  jamDTag: string,
  results: JamResults,
): UnsignedEvent {
  return {
    kind: KINDS.JAM_RESULT,
    content: JSON.stringify({ judge: results.judge }),
    tags: [
      ['d', `${jamDTag}:r:0`],
      ['a', jamCoordinate],
      ['truncated', String(results.truncatedAt)],
      ['client', CLIENT_NAME],
    ],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

function parseRows(raw: unknown): JamResultRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r): JamResultRow | null => {
      if (!r || typeof r.a !== 'string') return null
      return {
        a: r.a,
        r: Number(r.r) || 0,
        v: Number(r.v) || 0,
        s: Number(r.s) || 0,
        c: Array.isArray(r.c) ? r.c.map((n: unknown) => Number(n) || 0) : [],
      }
    })
    .filter((r): r is JamResultRow => !!r)
}

export function extractResults(event: NostrEvent): JamResults | null {
  try {
    const obj = JSON.parse(event.content)
    if (!obj || typeof obj !== 'object') return null
    return {
      judge: parseRows(obj.judge),
      truncatedAt: Number(event.tags.find((t) => t[0] === 'truncated')?.[1]) || RESULT_TOP_N,
    }
  } catch {
    return null
  }
}

/** Newest result event wins (addressable, so a re-tally replaces in place). */
export function latestResults(events: NostrEvent[]): JamResults | null {
  let newest: NostrEvent | null = null
  for (const ev of events) if (!newest || ev.created_at > newest.created_at) newest = ev
  return newest ? extractResults(newest) : null
}


/** An entry's published row, for rendering its rank on the entry itself. */
export function rowsForEntry(results: JamResults, coordinate: string): { judge: JamResultRow | null } {
  return { judge: results.judge.find((r) => r.a === coordinate) ?? null }
}
