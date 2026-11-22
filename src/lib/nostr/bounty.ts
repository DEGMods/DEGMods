import type { Event as NostrEvent, UnsignedEvent } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { KINDS, CLIENT_NAME } from '@/lib/constants'
import { cacheEvent } from '@/lib/nostr/eventCache'

// ─── Mod Bounty event (kind 31144) — see docs/mod-bounty-event.md ────
//
// A bounty is a public request for a mod that doesn't exist yet, for a specific
// game, with an optional (descriptive) reward. It's an addressable replaceable
// event so the requester can edit it — notably to mark a winner. A fulfilment is
// a mod (31142) tagged with the bounty's coordinate + the role "bounty-fulfillment"
// (exactly how jam entries link to a jam). The bounty's fulfilled/unfulfilled
// state is DERIVED from whether a winner `a` tag exists, and mirrored into a
// single-letter, relay-indexed `v` tag so listings stay filterable.

/** Role value a fulfilling mod carries in its `a` tag (3rd element). */
export const BOUNTY_FULFILLMENT_LABEL = 'bounty-fulfillment'
/** Bare `l` label on a third-party reward-pledge event (kind 31244). */
export const BOUNTY_REWARD_LABEL = 'bounty-reward'

export type BountyStatus = 'unfulfilled' | 'fulfilled'

/** A bounty's offered reward: what it is, and (optionally) how it's delivered. */
export interface BountyReward {
  what: string
  how: string
}

export interface BountyDetails {
  id: string
  pubkey: string
  dTag: string
  aTag: string // addressable coordinate: 31144:<pubkey>:<d>
  naddr: string
  createdAt: number
  publishedAt: number

  title: string
  image: string
  summary: string
  content: string
  game: string // the single `g` - the game the mod is wanted for
  tags: string[] // t
  contentWarning: string | null // NIP-36 reason, or null when not NSFW
  reward: BountyReward | null

  // Derived fulfilment state.
  status: BountyStatus
  fulfilled: boolean
  /** The chosen mod's coordinate (31142:…), present once a winner is picked. */
  winnerCoordinate: string | null
  winnerPubkey: string | null

  client: string
}

export interface BountyFormState {
  dTag: string
  isEdit?: boolean
  previousCreatedAt?: number
  publishedAt?: number

  title: string
  featuredImageUrl: string
  summary: string
  content: string
  game: string
  tags: string[]
  contentWarning: boolean
  contentWarningReason: string
  reward: BountyReward

  // Winner selection (set when the requester picks a fulfiller).
  winnerCoordinate?: string | null
  winnerPubkey?: string | null
}

export function buildBountyEvent(form: BountyFormState): UnsignedEvent {
  const now = Math.floor(Date.now() / 1000)
  const createdAt = form.isEdit && form.previousCreatedAt ? form.previousCreatedAt + 1 : now
  const publishedAt = form.publishedAt ?? now

  const tags: string[][] = [
    ['d', form.dTag],
    ['published_at', publishedAt.toString()],
    ['title', form.title],
    ['g', form.game],
  ]

  if (form.featuredImageUrl.trim()) tags.push(['image', form.featuredImageUrl.trim()])
  if (form.summary.trim()) tags.push(['summary', form.summary.trim()])

  const what = form.reward.what.trim()
  if (what) {
    const how = form.reward.how.trim()
    tags.push(how ? ['reward', what, how] : ['reward', what])
  }

  for (const t of form.tags.map((s) => s.trim()).filter(Boolean)) tags.push(['t', t.toLowerCase()])

  if (form.contentWarning) tags.push(['content-warning', form.contentWarningReason.trim() || 'nsfw'])

  // Winner selection + derived status. The presence of the winner `a` tag is the
  // single source of truth; `v` is recomputed from it so the two can't drift.
  const winnerCoord = form.winnerCoordinate?.trim()
  const winnerPk = form.winnerPubkey?.trim()
  if (winnerCoord && winnerPk) {
    tags.push(['a', winnerCoord])
    tags.push(['p', winnerPk])
    tags.push(['v', 'fulfilled'])
  } else {
    tags.push(['v', 'unfulfilled'])
  }

  tags.push(['client', CLIENT_NAME])

  return { kind: KINDS.BOUNTY, content: form.content, tags, created_at: createdAt, pubkey: '' }
}

export function extractBounty(event: NostrEvent): BountyDetails | null {
  if (event.kind !== KINDS.BOUNTY) return null
  cacheEvent(event)
  const get = (name: string) => event.tags.find((t) => t[0] === name)?.[1] ?? ''
  const all = (name: string) => event.tags.filter((t) => t[0] === name)
  const dTag = get('d')
  if (!dTag) return null

  // Winner selection: an `a` pointing at a mod coordinate (31142:…). Its presence
  // is authoritative for fulfilled-ness; the `v` tag is a derived mirror.
  const winnerATag = event.tags.find((t) => t[0] === 'a' && t[1]?.startsWith(`${KINDS.MOD}:`))
  const winnerCoordinate = winnerATag?.[1] ?? null
  const winnerPubkey = winnerCoordinate ? (get('p') || winnerCoordinate.split(':')[1] || null) : null
  const fulfilled = !!winnerCoordinate

  const rewardTag = event.tags.find((t) => t[0] === 'reward')
  const reward: BountyReward | null = rewardTag && rewardTag[1]
    ? { what: rewardTag[1], how: rewardTag[2] ?? '' }
    : null

  const cwTag = event.tags.find((t) => t[0] === 'content-warning')
  const nsfwLegacy = event.tags.find((t) => t[0] === 'nsfw' && t[1] === 'true')
  const contentWarning = cwTag ? (cwTag[1] || 'nsfw') : nsfwLegacy ? 'nsfw' : null

  const naddr = nip19.naddrEncode({ kind: KINDS.BOUNTY, pubkey: event.pubkey, identifier: dTag })

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    aTag: `${KINDS.BOUNTY}:${event.pubkey}:${dTag}`,
    naddr,
    createdAt: event.created_at,
    publishedAt: Number(get('published_at')) || event.created_at,
    title: get('title'),
    image: get('image'),
    summary: get('summary'),
    content: event.content,
    game: get('g'),
    tags: all('t').map((t) => t[1]).filter(Boolean),
    contentWarning,
    reward,
    status: fulfilled ? 'fulfilled' : 'unfulfilled',
    fulfilled,
    winnerCoordinate,
    winnerPubkey,
    client: get('client'),
  }
}

/**
 * Newest event per coordinate → BountyDetails (relays may return stale revisions).
 * Drops anything without a title or a game (a bounty must name its game).
 */
export function constructBountyListFromEvents(events: NostrEvent[]): BountyDetails[] {
  const byCoord = new Map<string, NostrEvent>()
  for (const ev of events) {
    const d = ev.tags.find((t) => t[0] === 'd')?.[1]
    if (!d) continue
    const key = `${ev.pubkey}:${d}`
    const prev = byCoord.get(key)
    if (!prev || ev.created_at > prev.created_at) byCoord.set(key, ev)
  }
  return [...byCoord.values()]
    .map(extractBounty)
    .filter((b): b is BountyDetails => !!b && !!b.title && !!b.game)
}

// ─── Coordinate helpers ──────────────────────────────────────────────

/** Decode a bounty naddr into its `31144:<pubkey>:<d>` coordinate (null if not one). */
export function bountyCoordinateFromNaddr(naddr: string): string | null {
  try {
    const decoded = nip19.decode(naddr.trim())
    if (decoded.type !== 'naddr' || decoded.data.kind !== KINDS.BOUNTY) return null
    return `${KINDS.BOUNTY}:${decoded.data.pubkey}:${decoded.data.identifier}`
  } catch {
    return null
  }
}

/** Encode a `31144:<pubkey>:<d>` coordinate back into a bounty naddr (null if malformed). */
export function bountyNaddrFromCoordinate(coordinate: string): string | null {
  const parts = coordinate.split(':')
  if (parts.length < 3 || Number(parts[0]) !== KINDS.BOUNTY) return null
  const pubkey = parts[1]
  const identifier = parts.slice(2).join(':')
  if (!pubkey || !identifier) return null
  try {
    return nip19.naddrEncode({ kind: KINDS.BOUNTY, pubkey, identifier })
  } catch {
    return null
  }
}

/** The coordinate (31142:<pk>:<d>) of a mod, for use as a bounty's winner selection. */
export function modCoordinate(mod: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags'>): string | null {
  const d = mod.tags.find((t) => t[0] === 'd')?.[1]
  if (!d) return null
  return `${KINDS.MOD}:${mod.pubkey}:${d}`
}

// ─── Fulfilment linking (a mod submitted to a bounty) ────────────────

/**
 * The tag a mod carries to become a bounty fulfilment: a single `a` reference to
 * the bounty with the role as its third value (mirrors jam `submissionTags`).
 */
export function fulfillmentTags(bountyCoordinate: string): string[][] {
  return [['a', bountyCoordinate, BOUNTY_FULFILLMENT_LABEL]]
}

/**
 * Whether a mod event references this bounty as a fulfilment: an `a` pointing at
 * the bounty whose role is "bounty-fulfillment", or (legacy) a bare `a` alongside
 * a separate `l=bounty-fulfillment` label. Mirrors isJamEntry.
 */
export function isBountyFulfillment(mod: NostrEvent, bountyCoordinate: string): boolean {
  const aTag = mod.tags.find((t) => t[0] === 'a' && t[1] === bountyCoordinate)
  if (!aTag) return false
  if (aTag[2] === BOUNTY_FULFILLMENT_LABEL) return true
  return mod.tags.some((t) => t[0] === 'l' && t[1] === BOUNTY_FULFILLMENT_LABEL) // legacy
}

/**
 * A fulfilment is valid (rendered, selectable as winner) only if it's a mod, not a
 * repost, and its game matches the bounty's game. See docs/mod-bounty-event.md.
 */
export function isValidFulfillment(mod: NostrEvent, bounty: Pick<BountyDetails, 'game'>): boolean {
  if (mod.kind !== KINDS.MOD) return false
  if (mod.tags.some((t) => t[0] === 'repost' && t[1] === 'true')) return false
  const modGame = mod.tags.find((t) => t[0] === 'g')?.[1] ?? ''
  return !!modGame && modGame === bounty.game
}
