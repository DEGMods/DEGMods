import type { Event as NostrEvent, UnsignedEvent } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { KINDS, CLIENT_NAME } from '@/lib/constants'
import type { JamCriterion, JamDetails } from '@/lib/nostr/jam'

// ─── Ballots (kind 31243) — see docs/jam-event.md ───────────────────

/** The single "overall" criterion used when a jam declares no custom criteria. */
export const OVERALL_CRITERION = 'overall'
export const OVERALL_MAX = 10

export interface JamScore { criterion: string; value: number }

export interface JamBallotFormState {
  jamCoordinate: string        // 31143:<jam-pk>:<jam-d>
  jamDTag: string
  submissionCoordinate: string // 31142:<mod-pk>:<mod-d>
  submissionDTag: string
  scores: JamScore[]
  comment: string
}

export interface JamBallot {
  id: string
  pubkey: string
  dTag: string
  createdAt: number
  jamCoordinate: string
  submissionCoordinate: string
  scores: JamScore[]
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

export function buildBallotEvent(form: JamBallotFormState): UnsignedEvent {
  // Ballots always stamp created_at = now (even on edit) so a post-deadline edit
  // self-invalidates. See docs/jam-event.md.
  const tags: string[][] = [
    ['d', ballotDTag(form.jamDTag, form.submissionDTag)],
    ['a', form.jamCoordinate],
    ['a', form.submissionCoordinate],
    ...form.scores.map((s) => ['score', s.criterion, String(s.value)]),
    ['client', CLIENT_NAME],
  ]
  return {
    kind: KINDS.JAM_BALLOT,
    content: form.comment.trim(),
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
  const scores: JamScore[] = event.tags
    .filter((t) => t[0] === 'score' && t[1])
    .map((t) => ({ criterion: t[1], value: Number(t[2]) }))
    .filter((s) => Number.isFinite(s.value))
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag: event.tags.find((t) => t[0] === 'd')?.[1] ?? '',
    createdAt: event.created_at,
    jamCoordinate,
    submissionCoordinate,
    scores,
    comment: event.content,
  }
}

/** True if the ballot's created_at falls inside the voting window and scores are well-formed. */
export function isBallotCounted(
  event: NostrEvent,
  jam: Pick<JamDetails, 'end' | 'votingEnd' | 'criteria' | 'scoreMax'>,
): boolean {
  if (!jam.votingEnd) return false
  if (event.created_at < jam.end || event.created_at > jam.votingEnd) return false
  const ballot = extractBallot(event)
  if (!ballot || ballot.scores.length === 0) return false
  const maxByLabel = new Map(ballotCriteria(jam).map((c) => [c.label, c.max]))
  for (const s of ballot.scores) {
    const max = maxByLabel.get(s.criterion)
    if (max === undefined) continue // unknown criterion — ignore, don't reject
    if (s.value < 0 || s.value > max) return false
  }
  return true
}

/** Hex pubkeys of the jam's judges (only npub-form entries are self-verifiable). */
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
  avg: number                          // mean of the per-criterion averages
  votes: number
  perCriterion: Record<string, number> // criterion label → average
}

export interface EntryAggregate {
  coordinate: string // 31142:<mod-pk>:<mod-d>
  judge: TrackAggregate
  user: TrackAggregate
  jRank: number
  uRank: number
}

function emptyTrack(): TrackAggregate { return { avg: 0, votes: 0, perCriterion: {} } }

/** Average one track's ballots for one entry, per criterion + overall. */
function aggregateTrack(ballots: JamBallot[]): TrackAggregate {
  if (ballots.length === 0) return emptyTrack()
  const sums = new Map<string, { total: number; n: number }>()
  for (const b of ballots) {
    for (const s of b.scores) {
      const cur = sums.get(s.criterion) ?? { total: 0, n: 0 }
      cur.total += s.value; cur.n += 1
      sums.set(s.criterion, cur)
    }
  }
  const perCriterion: Record<string, number> = {}
  for (const [label, { total, n }] of sums) perCriterion[label] = n ? total / n : 0
  const labels = Object.keys(perCriterion)
  const avg = labels.length ? labels.reduce((a, l) => a + perCriterion[l], 0) / labels.length : 0
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
): EntryAggregate[] {
  const byEntry = new Map<string, { judge: JamBallot[]; user: JamBallot[] }>()
  for (const coord of entryCoordinates) byEntry.set(coord, { judge: [], user: [] })
  for (const b of countedBallots) {
    const bucket = byEntry.get(b.submissionCoordinate)
    if (!bucket) continue // ballot for an unknown/invalid entry
    bucket.user.push(b)
    if (judgeHexes.has(b.pubkey)) bucket.judge.push(b)
  }

  const aggregates: EntryAggregate[] = [...byEntry.entries()].map(([coordinate, { judge, user }]) => ({
    coordinate,
    judge: aggregateTrack(judge),
    user: aggregateTrack(user),
    jRank: 0,
    uRank: 0,
  }))

  assignRank(aggregates, 'judge', (a) => a.jRank, (a, r) => { a.jRank = r })
  assignRank(aggregates, 'user', (a) => a.uRank, (a, r) => { a.uRank = r })
  return aggregates
}

/** Rank by avg desc, tie-broken by vote count desc. Zero-vote entries share the last rank 0. */
function assignRank(
  aggregates: EntryAggregate[],
  track: 'judge' | 'user',
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

// ─── Results (kind 31343) — paged leaderboard ───────────────────────

export interface JamResultRow {
  a: string // entry coordinate 31142:<pk>:<d>
  judge: { avg: number; votes: number }
  user: { avg: number; votes: number }
  jRank: number
  uRank: number
}

/** Split rows into ~perPage-sized pages. */
export function resultPages<T>(rows: T[], perPage = 100): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage))
  return pages.length ? pages : [[]]
}

export function aggregateToRow(a: EntryAggregate): JamResultRow {
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    a: a.coordinate,
    judge: { avg: round(a.judge.avg), votes: a.judge.votes },
    user: { avg: round(a.user.avg), votes: a.user.votes },
    jRank: a.jRank,
    uRank: a.uRank,
  }
}

export function buildResultPageEvent(
  jamCoordinate: string,
  jamDTag: string,
  pageIndex: number,
  pageTotal: number,
  rows: JamResultRow[],
): UnsignedEvent {
  return {
    kind: KINDS.JAM_RESULT,
    content: JSON.stringify(rows),
    tags: [
      ['d', `${jamDTag}:r:${pageIndex}`],
      ['a', jamCoordinate],
      ['page', String(pageIndex), String(pageTotal)],
      ['client', CLIENT_NAME],
    ],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

export function extractResultRows(event: NostrEvent): JamResultRow[] {
  try {
    const arr = JSON.parse(event.content)
    if (!Array.isArray(arr)) return []
    return arr
      .map((r): JamResultRow | null => {
        if (!r || typeof r.a !== 'string') return null
        const track = (t: unknown) => ({
          avg: Number((t as { avg?: unknown })?.avg) || 0,
          votes: Number((t as { votes?: unknown })?.votes) || 0,
        })
        return { a: r.a, judge: track(r.judge), user: track(r.user), jRank: Number(r.jRank) || 0, uRank: Number(r.uRank) || 0 }
      })
      .filter((r): r is JamResultRow => !!r)
  } catch {
    return []
  }
}

/** Merge result pages (kind 31343) into one coordinate→row map, newest page-set wins. */
export function mergeResultPages(events: NostrEvent[]): Map<string, JamResultRow> {
  // Keep only the newest event per `d` (paged replaceable), then flatten.
  const byD = new Map<string, NostrEvent>()
  for (const ev of events) {
    const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    const cur = byD.get(d)
    if (!cur || ev.created_at > cur.created_at) byD.set(d, ev)
  }
  const rows = new Map<string, JamResultRow>()
  for (const ev of byD.values()) for (const row of extractResultRows(ev)) rows.set(row.a, row)
  return rows
}
