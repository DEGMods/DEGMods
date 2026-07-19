/**
 * NIP-SHORT — short, human-readable addresses for events.
 *
 *   s<authority><code>[-<selector>]
 *
 * `authority` is the author (an `npub1…`, or a DNN ID which resolves to one),
 * `code` is the first 6 hex characters of SHA-256 over a canonical input, and
 * the optional `-selector` continues that same hash to break a collision.
 *
 * The code lives in the event as a single-letter `["s", code]` tag, so it is
 * relay-indexed and signed — there is no side mapping to publish or keep alive.
 * The canonical input deliberately excludes tags, which is what lets the code be
 * one of them.
 *
 * See docs: git.nostrdev.com/freakoverse/DNN → docs/NIPS/NIP-SHORT.md
 */
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { nip19, verifyEvent, type Event as NostrEvent } from 'nostr-tools'
import { KINDS } from '@/lib/constants'
import { fetchEvents } from '@/lib/nostr/relay-pool'

export const SHORT_CODE_LENGTH = 6

const CODE_RE = /^[0-9a-f]{6}$/
const SUFFIX_RE = /^[0-9a-f]+$/

/** The identity-determining fields a code is derived from. Never tags. */
export interface CodeSource {
  kind: number
  pubkey: string
  created_at: number
  content: string
  tags: string[][]
}

/**
 * Replaceable and addressable kinds derive from their coordinate rather than
 * their content, so the code survives every edit.
 */
export function isCoordinateKind(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000) || (kind >= 30000 && kind < 40000)
}

export function canonicalInput(source: CodeSource): string {
  if (isCoordinateKind(source.kind)) {
    const d = source.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    return `a:${source.kind}:${source.pubkey}:${d}`
  }
  return `e:${source.kind}:${source.pubkey}:${source.created_at}:${source.content}`
}

/** Full digest — the code is its head, collision selectors continue from there. */
export function computeFullHash(source: CodeSource): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalInput(source))))
}

export function computeShortCode(source: CodeSource): string {
  return computeFullHash(source).slice(0, SHORT_CODE_LENGTH)
}

/** The `s` tag an event carries, if any. */
export function shortCodeOf(event: NostrEvent): string | null {
  const v = event.tags.find((t) => t[0] === 's')?.[1]
  return v && CODE_RE.test(v) ? v : null
}

/** Kinds DEG Mods stamps with a short code when publishing. */
export const SHORT_KINDS: ReadonlySet<number> = new Set<number>([
  KINDS.SHORT_NOTE,
  KINDS.BLOG,
  KINDS.MOD,
  KINDS.JAM,
  1111, // NIP-22 comments
])

// ─── Addresses ──────────────────────────────────────────────────────

export interface ShortAddress {
  authority: string // npub1… or a DNN ID
  code: string
  suffix: string // '' when absent
}

export function formatShortAddress(authority: string, code: string, suffix = ''): string {
  return `s${authority}${code}${suffix ? `-${suffix}` : ''}`
}

/**
 * Parse `s<authority><code>[-selector]`.
 *
 * The authority is variable-length and the code is fixed, so the code is peeled
 * off the *end* — there is no delimiter between them to split on.
 */
export function parseShortAddress(input: string): ShortAddress | null {
  const raw = input.trim().replace(/^nostr:/i, '')
  if (!raw.startsWith('s') || raw.length < 2 + SHORT_CODE_LENGTH) return null
  const body = raw.slice(1)

  const dash = body.indexOf('-')
  const head = dash === -1 ? body : body.slice(0, dash)
  const suffix = dash === -1 ? '' : body.slice(dash + 1).toLowerCase()
  if (suffix && !SUFFIX_RE.test(suffix)) return null

  const code = head.slice(-SHORT_CODE_LENGTH).toLowerCase()
  const authority = head.slice(0, -SHORT_CODE_LENGTH)
  if (!CODE_RE.test(code) || !authority) return null
  return { authority, code, suffix }
}

/**
 * Does this look like a short address rather than a bare npub or DNN ID?
 *
 * `snpub1…` and `sn…` are short addresses; `npub1…` and `n…` are not. The `s`
 * marker is the whole distinction.
 */
export function looksLikeShortAddress(input: string): boolean {
  return parseShortAddress(input) !== null
}

/** Hex pubkey for an authority, or null when it isn't an npub we can decode. */
export function authorityToPubkey(authority: string): string | null {
  if (/^npub1/i.test(authority)) {
    try {
      const d = nip19.decode(authority)
      return d.type === 'npub' ? (d.data as string) : null
    } catch { return null }
  }
  return null
}

// ─── Sharing ────────────────────────────────────────────────────────

/**
 * The address to share for an event, adding a collision selector only when the
 * author actually has another event on the same code.
 *
 * The stored tag never changes — disambiguation lives in the address alone, by
 * reading further along the same hash.
 */
export async function shareableShortAddress(
  relays: string[],
  event: NostrEvent,
  authority?: string,
): Promise<string | null> {
  const code = shortCodeOf(event) ?? computeShortCode(event)
  if (!CODE_RE.test(code)) return null
  const auth = authority || nip19.npubEncode(event.pubkey)

  let others: NostrEvent[] = []
  try {
    others = await fetchEvents(relays, { authors: [event.pubkey], '#s': [code] }, 2000)
  } catch {
    // Can't check — share the base address rather than nothing. A collision
    // would show a disambiguation prompt on resolve, not a wrong event.
    return formatShortAddress(auth, code)
  }

  const rivals = others.filter((e) => e.id !== event.id && verifyShortCode(e))
  if (rivals.length === 0) return formatShortAddress(auth, code)

  // Grow the selector one hex character at a time until this event's hash is
  // distinguishable from every rival's.
  const mine = computeFullHash(event)
  const theirs = rivals.map(computeFullHash)
  for (let n = SHORT_CODE_LENGTH + 1; n <= mine.length; n++) {
    const prefix = mine.slice(0, n)
    if (theirs.every((h) => !h.startsWith(prefix))) {
      return formatShortAddress(auth, code, mine.slice(SHORT_CODE_LENGTH, n))
    }
  }
  return formatShortAddress(auth, code)
}

/**
 * Decode a post route param, which may be an `naddr1…` or a short address.
 *
 * A short address resolves to a real event, so the coordinate comes back the
 * same shape either way and callers keep their existing cache/refresh flow. The
 * resolved event is returned too, so the caller doesn't refetch what we just had
 * in hand.
 */
export async function decodePostParam(
  param: string,
  relays: string[],
): Promise<{ kind: number; pubkey: string; identifier: string; event?: NostrEvent } | null> {
  if (looksLikeShortAddress(param)) {
    const res = await resolveShortAddress(relays, param)
    if (res.status !== 'resolved') return null
    const ev = res.event
    return {
      kind: ev.kind,
      pubkey: ev.pubkey,
      identifier: ev.tags.find((t) => t[0] === 'd')?.[1] ?? '',
      event: ev,
    }
  }
  try {
    const d = nip19.decode(param)
    if (d.type !== 'naddr') return null
    return { kind: d.data.kind, pubkey: d.data.pubkey, identifier: d.data.identifier }
  } catch {
    return null
  }
}

// ─── Resolution ─────────────────────────────────────────────────────

/** An event's `s` tag must match what its own fields hash to, and it must verify. */
export function verifyShortCode(event: NostrEvent): boolean {
  const claimed = shortCodeOf(event)
  if (!claimed || claimed !== computeShortCode(event)) return false
  try { return verifyEvent(event) } catch { return false }
}

export type ShortResolution =
  | { status: 'resolved'; event: NostrEvent }
  | { status: 'ambiguous'; candidates: NostrEvent[] }
  | { status: 'not-found' }
  | { status: 'bad-address' }

/**
 * Resolve a short address to its event.
 *
 * Verification is not optional: the `s` tag is self-asserted, so every candidate
 * is re-hashed from its own fields and signature-checked before it counts.
 * Without that, anyone could tag an event with someone else's code.
 */
export async function resolveShortAddress(
  relays: string[],
  address: string,
  resolveAuthority?: (authority: string) => Promise<string | null>,
): Promise<ShortResolution> {
  const parsed = parseShortAddress(address)
  if (!parsed) return { status: 'bad-address' }

  let pubkey = authorityToPubkey(parsed.authority)
  if (!pubkey && resolveAuthority) pubkey = await resolveAuthority(parsed.authority)
  if (!pubkey) return { status: 'bad-address' }

  let events: NostrEvent[] = []
  try {
    events = await fetchEvents(relays, { authors: [pubkey], '#s': [parsed.code] }, 6000)
  } catch {
    return { status: 'not-found' }
  }

  const verified = events.filter(verifyShortCode)
  if (verified.length === 0) return { status: 'not-found' }

  if (parsed.suffix) {
    const want = parsed.code + parsed.suffix
    const matches = verified.filter((e) => computeFullHash(e).startsWith(want))
    if (matches.length === 1) return { status: 'resolved', event: matches[0] }
    if (matches.length === 0) return { status: 'not-found' }
    return { status: 'ambiguous', candidates: matches }
  }

  // A replaceable/addressable coordinate legitimately returns several revisions
  // of one event — that's not ambiguity, it's history. Keep the newest.
  const byCoord = new Map<string, NostrEvent>()
  for (const e of verified) {
    const key = isCoordinateKind(e.kind)
      ? `${e.kind}:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`
      : e.id
    const cur = byCoord.get(key)
    if (!cur || e.created_at > cur.created_at) byCoord.set(key, e)
  }
  const candidates = [...byCoord.values()]
  if (candidates.length === 1) return { status: 'resolved', event: candidates[0] }
  return { status: 'ambiguous', candidates }
}
