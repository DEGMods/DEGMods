import type { Event as NostrEvent, UnsignedEvent } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { KINDS, CLIENT_NAME } from '@/lib/constants'

// ─── Jam event (kind 31143) — see docs/jam-event.md ──────────────────

export const JAM_ENTRY_LABEL = 'jam-entry'
/** Clients must not publish a jam whose start→(voting_end||end) span exceeds this. */
export const MAX_JAM_DURATION_SECONDS = 366 * 24 * 60 * 60 // ~12 months

export type JamType = 'mod' | 'game'

export interface JamCriterion { label: string; max: number }
export type JamReward =
  | { type: 'monetary'; currency: string; amount: string }
  | { type: 'other'; text: string }
export interface JamFaq { question: string; answer: string }

export interface JamDetails {
  id: string
  pubkey: string
  dTag: string
  coordinate: string // 31143:<pubkey>:<d>
  naddr: string
  createdAt: number
  publishedAt: number

  title: string
  image: string
  video: string
  summary: string
  content: string
  contentWarning: string | null
  screenshots: string[]
  tags: string[] // t
  games: string[] // g (0 = general)
  jamType: JamType

  start: number
  end: number
  votingEnabled: boolean
  userVotingEnabled: boolean
  judges: string[] // names or npubs
  votingEnd: number | null
  criteria: JamCriterion[] // empty = single "overall" 0-10
  rewards: JamReward[]
  rewardNote: string
  relays: string[]
  faq: JamFaq[]
  resultsAt: number | null
}

export interface JamFormState {
  dTag: string
  isEdit?: boolean
  previousCreatedAt?: number
  publishedAt?: number

  title: string
  featuredImageUrl: string
  featuredVideoUrl: string
  summary: string
  content: string
  contentWarning: boolean
  contentWarningReason: string
  screenshots: string[]
  tags: string[]
  games: string[]
  jamType: JamType

  start: number
  end: number
  votingEnabled: boolean
  userVotingEnabled: boolean
  judges: string[]
  votingEnd: number | null
  criteria: JamCriterion[]
  rewards: JamReward[]
  rewardNote: string
  relays: string[]
  faq: JamFaq[]
  resultsAt?: number | null
}

/** One `YYYY-MM` (UTC) per calendar month spanned by [startTs, endTs] inclusive. */
export function monthBuckets(startTs: number, endTs: number): string[] {
  const out: string[] = []
  const s = new Date(startTs * 1000)
  let y = s.getUTCFullYear()
  let m = s.getUTCMonth() // 0-based
  const end = new Date(Math.max(endTs, startTs) * 1000)
  const ey = end.getUTCFullYear()
  const em = end.getUTCMonth()
  // hard stop so a bad range can never loop away (12-month cap → 13 buckets)
  for (let i = 0; i < 13 && (y < ey || (y === ey && m <= em)); i++) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`)
    if (++m > 11) { m = 0; y++ }
  }
  return out
}

/** UTC month bucket key ("YYYY-MM") for a unix timestamp — matches monthBuckets(). */
export function monthKey(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Human label for a "YYYY-MM" bucket, e.g. "Feb 2026". */
export function monthLabel(bucket: string): string {
  const [y, m] = bucket.split('-').map(Number)
  if (!y || !m) return bucket
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function buildJamEvent(form: JamFormState): UnsignedEvent {
  const now = Math.floor(Date.now() / 1000)
  const createdAt = form.isEdit && form.previousCreatedAt ? form.previousCreatedAt + 1 : now
  const publishedAt = form.publishedAt ?? now
  const bucketEnd = (form.votingEnabled || form.userVotingEnabled) && form.votingEnd ? form.votingEnd : form.end

  const tags: string[][] = [
    ['d', form.dTag],
    ['published_at', publishedAt.toString()],
    ['title', form.title],
    ['image', form.featuredImageUrl],
    ['summary', form.summary],
    ['j', form.jamType],
    ['start', String(form.start)],
    ['end', String(form.end)],
  ]

  for (const g of form.games.map((s) => s.trim()).filter(Boolean)) tags.push(['g', g])
  for (const b of monthBuckets(form.start, bucketEnd)) tags.push(['y', b])

  if (form.featuredVideoUrl.trim()) tags.push(['video', form.featuredVideoUrl.trim()])
  if (form.contentWarning) tags.push(['content-warning', form.contentWarningReason || 'nsfw'])
  const shots = form.screenshots.map((s) => s.trim()).filter(Boolean)
  if (shots.length) tags.push(['screenshots', ...shots])
  for (const t of form.tags.map((s) => s.trim()).filter(Boolean)) tags.push(['t', t.toLowerCase()])

  if (form.votingEnabled) tags.push(['voting', 'true'])
  if (form.userVotingEnabled) tags.push(['user-voting', 'true'])
  if (form.votingEnabled) for (const j of form.judges.map((s) => s.trim()).filter(Boolean)) tags.push(['judge', j])
  if ((form.votingEnabled || form.userVotingEnabled) && form.votingEnd) tags.push(['voting_end', String(form.votingEnd)])
  if (form.votingEnabled || form.userVotingEnabled) {
    for (const c of form.criteria) {
      const label = c.label.trim()
      if (label) tags.push(['criterion', label, String(c.max || 10)])
    }
  }

  for (const r of form.rewards) {
    if (r.type === 'monetary') {
      if (r.currency.trim() && r.amount.trim()) tags.push(['reward', 'monetary', r.currency.trim(), r.amount.trim()])
    } else if (r.text.trim()) {
      tags.push(['reward', 'other', r.text.trim()])
    }
  }
  if (form.rewardNote.trim()) tags.push(['reward_note', form.rewardNote.trim()])

  const relays = form.relays.map((s) => s.trim()).filter(Boolean)
  if (relays.length) tags.push(['relays', ...relays])
  for (const f of form.faq) {
    if (f.question.trim() && f.answer.trim()) tags.push(['faq', f.question.trim(), f.answer.trim()])
  }
  if (form.resultsAt) tags.push(['results', String(form.resultsAt)])

  tags.push(['client', CLIENT_NAME])

  return { kind: KINDS.JAM, content: form.content, tags, created_at: createdAt, pubkey: '' }
}

export function extractJam(event: NostrEvent): JamDetails | null {
  if (event.kind !== KINDS.JAM) return null
  const get = (name: string) => event.tags.find((t) => t[0] === name)?.[1] ?? ''
  const all = (name: string) => event.tags.filter((t) => t[0] === name)
  const dTag = get('d')
  const start = Number(get('start')) || 0
  const end = Number(get('end')) || 0
  if (!dTag || !start || !end) return null

  const votingEnabled = get('voting') === 'true'
  const userVotingEnabled = get('user-voting') === 'true'
  const votingEndRaw = Number(get('voting_end')) || 0
  const cwTag = event.tags.find((t) => t[0] === 'content-warning')
  const nsfwLegacy = event.tags.find((t) => t[0] === 'nsfw' && t[1] === 'true')

  const rewards: JamReward[] = []
  for (const r of all('reward')) {
    if (r[1] === 'monetary' && r[2] && r[3]) rewards.push({ type: 'monetary', currency: r[2], amount: r[3] })
    else if (r[1] === 'other' && r[2]) rewards.push({ type: 'other', text: r[2] })
  }

  const naddr = nip19.naddrEncode({ kind: KINDS.JAM, pubkey: event.pubkey, identifier: dTag })

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    coordinate: `${KINDS.JAM}:${event.pubkey}:${dTag}`,
    naddr,
    createdAt: event.created_at,
    publishedAt: Number(get('published_at')) || event.created_at,
    title: get('title'),
    image: get('image'),
    video: get('video'),
    summary: get('summary'),
    content: event.content,
    contentWarning: cwTag ? (cwTag[1] || 'nsfw') : nsfwLegacy ? 'nsfw' : null,
    screenshots: (all('screenshots')[0] ?? []).slice(1).filter(Boolean),
    tags: all('t').map((t) => t[1]).filter(Boolean),
    games: all('g').map((t) => t[1]).filter(Boolean),
    jamType: get('j') === 'game' ? 'game' : 'mod',
    start,
    end,
    votingEnabled,
    userVotingEnabled,
    judges: all('judge').map((t) => t[1]).filter(Boolean),
    votingEnd: votingEndRaw || null,
    criteria: all('criterion').map((t) => ({ label: t[1], max: Number(t[2]) || 10 })).filter((c) => c.label),
    rewards,
    rewardNote: get('reward_note'),
    relays: (all('relays')[0] ?? []).slice(1).filter(Boolean),
    faq: all('faq').filter((t) => t[1] && t[2]).map((t) => ({ question: t[1], answer: t[2] })),
    resultsAt: Number(get('results')) || null,
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────

export type JamStatus = 'upcoming' | 'active' | 'voting' | 'ended'

/** Current phase of a jam relative to `now` (seconds). */
export function jamStatus(jam: Pick<JamDetails, 'start' | 'end' | 'votingEnd' | 'votingEnabled' | 'userVotingEnabled'>, now: number): JamStatus {
  if (now < jam.start) return 'upcoming'
  if (now < jam.end) return 'active'
  const hasVoting = jam.votingEnabled || jam.userVotingEnabled
  if (hasVoting && jam.votingEnd && now < jam.votingEnd) return 'voting'
  return 'ended'
}

/** Combine a local "YYYY-MM-DD" date and "HH:mm" time into a UTC unix timestamp (seconds). */
export function localToUnix(date: string, time: string): number | null {
  if (!date || !time) return null
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  if (!y || !mo || !d || Number.isNaN(h) || Number.isNaN(mi)) return null
  return Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000)
}

/** Split a UTC unix timestamp into local "YYYY-MM-DD" + "HH:mm" for editing. */
export function unixToLocal(ts: number): { date: string; time: string } {
  const d = new Date(ts * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` }
}

/** Compact countdown like "2mo 3d 4h" — the top 3 significant units, down to seconds. */
export function formatCountdown(secondsLeft: number): string {
  let s = Math.max(0, Math.floor(secondsLeft))
  const units: [number, string][] = [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']]
  const parts: string[] = []
  for (const [size, label] of units) {
    const v = Math.floor(s / size)
    s -= v * size
    if (parts.length === 0 && v === 0) continue // skip leading zeros
    parts.push(`${v}${label}`)
    if (parts.length === 3) break
  }
  return parts.length ? parts.join(' ') : '0s'
}

/** The countdown label shown on cards/pages for the jam's current phase. */
export function jamCountdownLabel(jam: JamDetails, now: number): string {
  switch (jamStatus(jam, now)) {
    case 'upcoming': return `Starting in ${formatCountdown(jam.start - now)}`
    case 'active': return `Ending in ${formatCountdown(jam.end - now)}`
    case 'voting': return `Voting ends in ${formatCountdown((jam.votingEnd ?? jam.end) - now)}`
    default: return 'Ended'
  }
}

/** Submissions become viewable once the jam ends (i.e. voting has started, or there's no voting). */
export function submissionsOpen(jam: Pick<JamDetails, 'start' | 'end' | 'votingEnd' | 'votingEnabled' | 'userVotingEnabled'>, now: number): boolean {
  return now >= jam.end
}

// ─── Submission linking (a mod entered into a jam) ───────────────────

/** The two tags a mod carries to become a jam entry. */
export function submissionTags(jamCoordinate: string): string[][] {
  return [['a', jamCoordinate], ['l', JAM_ENTRY_LABEL]]
}

/** Decode a jam naddr into its `31143:<pubkey>:<d>` coordinate (null if not a jam naddr). */
export function jamCoordinateFromNaddr(naddr: string): string | null {
  try {
    const decoded = nip19.decode(naddr.trim())
    if (decoded.type !== 'naddr' || decoded.data.kind !== KINDS.JAM) return null
    return `${KINDS.JAM}:${decoded.data.pubkey}:${decoded.data.identifier}`
  } catch {
    return null
  }
}

/** Encode a `31143:<pubkey>:<d>` coordinate back into a jam naddr (null if malformed). */
export function jamNaddrFromCoordinate(coordinate: string): string | null {
  const parts = coordinate.split(':')
  if (parts.length < 3 || Number(parts[0]) !== KINDS.JAM) return null
  const pubkey = parts[1]
  const identifier = parts.slice(2).join(':')
  if (!pubkey || !identifier) return null
  try {
    return nip19.naddrEncode({ kind: KINDS.JAM, pubkey, identifier })
  } catch {
    return null
  }
}

/** Whether a mod event references this jam as an entry (has the a + l tags). */
export function isJamEntry(mod: NostrEvent, jamCoordinate: string): boolean {
  const hasA = mod.tags.some((t) => t[0] === 'a' && t[1] === jamCoordinate)
  const hasL = mod.tags.some((t) => t[0] === 'l' && t[1] === JAM_ENTRY_LABEL)
  return hasA && hasL
}

/**
 * A submission is valid (shown/counted) only if it was originally published during
 * the jam and isn't a repost. See docs/jam-event.md "Valid submission".
 */
export function isValidSubmission(mod: NostrEvent, jam: Pick<JamDetails, 'start' | 'end'>): boolean {
  const publishedAt = Number(mod.tags.find((t) => t[0] === 'published_at')?.[1]) || mod.created_at
  const isRepost = mod.tags.some((t) => t[0] === 'repost' && t[1] === 'true')
  if (isRepost) return false
  // published_at is the authoritative gate; created_at only as a lower-bound sanity
  // check (+ a generous upper grace, since edits drift created_at up via +1).
  const GRACE = 24 * 60 * 60
  if (publishedAt < jam.start || publishedAt > jam.end) return false
  if (mod.created_at < jam.start || mod.created_at > jam.end + GRACE) return false
  return true
}
