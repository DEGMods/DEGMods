/**
 * NIP-SHORT — short, human-readable addresses for events.
 *
 *   s<authority><code>[-<selector>]
 *
 * `authority` is the author — a `key36` (the pubkey in base 36, 50 chars) in the
 * current form, or, in links already out in the world, an `npub1…` or a DNN ID.
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
import { dnnService } from '@/lib/dnn/dnnService'

export const SHORT_CODE_LENGTH = 6
/** The author component of a v2 address: a pubkey in base 36, always this wide. */
export const KEY36_LENGTH = 50

const CODE_RE = /^[0-9a-f]{6}$/
const SUFFIX_RE = /^[0-9a-f]+$/
const KEY36_RE = /^[0-9a-z]{50}$/

// ─── Author key encoding (key36) ────────────────────────────────────
//
// The v2 address carries the author as the 32-byte pubkey written in base 36 —
// the same information as the hex pubkey or the npub, in 50 characters against
// 64 and 63, and with no `npub1` prefix or checksum to spend length on. It is
// address-only: the signed `s` code never depends on it (see Derivation).

/** 64-char hex pubkey → its 50-char lowercase base-36 form. */
export function toKey36(pubkeyHex: string): string {
  return BigInt('0x' + pubkeyHex).toString(36).padStart(KEY36_LENGTH, '0')
}

/**
 * key36 → 64-char hex pubkey, or null when the string isn't a valid key36 —
 * wrong shape, or a value of 2²⁵⁶ or greater (which maps to no pubkey). The
 * conversion is exact and lossless, so a mistyped key36 simply decodes to a
 * different, effectively unowned pubkey and resolves to nothing rather than
 * erroring.
 */
export function key36ToPubkey(key36: string): string | null {
  const k = key36.toLowerCase()
  if (!KEY36_RE.test(k)) return null
  let n = 0n
  for (const c of k) n = n * 36n + BigInt(parseInt(c, 36))
  if (n >= 1n << 256n) return null
  return n.toString(16).padStart(64, '0')
}

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
 * Two authority forms coexist. The current (v2) form writes the author as a
 * fixed 50-char key36, so the head is exactly 56 characters — recognized by its
 * width and a valid key36 decode, since the base-36 alphabet overlaps hex and
 * can't be told from the code by scanning. The legacy (v1) form wrote the author
 * in full (an npub or a DNN id) with no delimiter, so the fixed-width code is
 * peeled off the *end*; it's still parsed so links already shared keep working.
 */
export function parseShortAddress(input: string): ShortAddress | null {
  const raw = input.trim().replace(/^nostr:/i, '')
  if (!raw.startsWith('s') || raw.length < 2 + SHORT_CODE_LENGTH) return null
  const body = raw.slice(1)

  const dash = body.indexOf('-')
  const head = dash === -1 ? body : body.slice(0, dash)
  const suffix = dash === -1 ? '' : body.slice(dash + 1).toLowerCase()
  if (suffix && !SUFFIX_RE.test(suffix)) return null

  // v2: 50-char key36 author + 6-hex code. Only a head of exactly this width
  // whose first 50 chars decode to a real pubkey is treated as key36; otherwise
  // it falls through to the legacy peel below.
  if (head.length === KEY36_LENGTH + SHORT_CODE_LENGTH) {
    const key36 = head.slice(0, KEY36_LENGTH).toLowerCase()
    const code = head.slice(KEY36_LENGTH).toLowerCase()
    if (CODE_RE.test(code) && key36ToPubkey(key36)) return { authority: key36, code, suffix }
  }

  // v1 (legacy): author written in full, code peeled off the end.
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

/**
 * Hex pubkey for an authority with no network: a key36 (v2) or an npub (legacy).
 * A DNN id isn't decodable on its own — it returns null here and is handled by
 * the DNN resolver passed to `resolveShortAddress`.
 */
export function authorityToPubkey(authority: string): string | null {
  if (/^npub1/i.test(authority)) {
    try {
      const d = nip19.decode(authority)
      return d.type === 'npub' ? (d.data as string) : null
    } catch { return null }
  }
  // v2 key36 — a fixed 50-char base-36 key. DNN ids are far shorter, so the
  // width tells them apart; anything that isn't a valid key36 returns null.
  if (KEY36_RE.test(authority)) return key36ToPubkey(authority)
  return null
}

// ─── Sharing ────────────────────────────────────────────────────────

/**
 * The short address derivable with no network at all.
 *
 * The code is a signed field of the event, so it can be checked against what the
 * event's own contents hash to — a purely local test. Only *uniqueness* needs
 * relays, and a collision is rare enough that it's better to show the short
 * address at once and append a selector in the unlikely case one is needed than
 * to sit on a round trip every time.
 *
 * Null when the event carries no code, or carries one that doesn't verify.
 */
export function verifiedShortAddress(event: NostrEvent, authority?: string): string | null {
  const stored = shortCodeOf(event)
  if (!stored || stored !== computeShortCode(event)) return null
  return formatShortAddress(authority || toKey36(event.pubkey), stored)
}

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
  const auth = authority || toKey36(event.pubkey)

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
/**
 * Resolve a DNN-id authority to a hex pubkey via the DNN nodes.
 *
 * Only reached for a legacy DNN-form address — key36 and npub authorities decode
 * locally in `authorityToPubkey` and never get here. This is what keeps DNN
 * short links resolvable now that the current form writes key36 instead.
 */
async function dnnAuthorityToPubkey(authority: string): Promise<string | null> {
  try {
    const res = await dnnService.resolve(authority)
    if (!res?.npub) return null
    const d = nip19.decode(res.npub)
    return d.type === 'npub' ? (d.data as string) : null
  } catch { return null }
}

export interface PostCoordinate { kind: number; pubkey: string; identifier: string; event?: NostrEvent }

/** The coordinate of a resolved event, in the shape callers already use. */
export function coordinateOf(ev: NostrEvent): PostCoordinate {
  return {
    kind: ev.kind,
    pubkey: ev.pubkey,
    identifier: ev.tags.find((t) => t[0] === 'd')?.[1] ?? '',
    event: ev,
  }
}

export async function decodePostParam(
  param: string,
  relays: string[],
): Promise<PostCoordinate | { candidates: NostrEvent[] } | null> {
  if (looksLikeShortAddress(param)) {
    const res = await resolveShortAddress(relays, param, dnnAuthorityToPubkey)
    // Ambiguity is handed back rather than swallowed — the link points at
    // something real, and only the reader can say which one.
    if (res.status === 'ambiguous') return { candidates: res.candidates }
    if (res.status !== 'resolved') return null
    return coordinateOf(res.event)
  }
  try {
    const d = nip19.decode(param)
    if (d.type !== 'naddr') return null
    return {
      kind: d.data.kind,
      pubkey: d.data.pubkey,
      identifier: stripSelfCoordPrefix(d.data.kind, d.data.pubkey, d.data.identifier),
    }
  } catch {
    return null
  }
}

/**
 * Undo an address whose identifier is its own full coordinate.
 *
 * Some links minted by the old site put `<kind>:<pubkey>:<d>` in the naddr's
 * identifier slot, where the event's actual `d` tag is only `<d>`. Filtering on
 * the doubled value matches nothing, so the post reads as deleted or missing —
 * while the same link still resolves on the old site. These addresses are out in
 * the world (shared, bookmarked, indexed) and can't be recalled, so they're
 * repaired on read.
 *
 * Anchored to *this* address's own kind and pubkey rather than a general
 * `<digits>:<hex>:` pattern, so a legitimate d-tag that merely contains colons
 * is left alone. Looped because the prefix was occasionally doubled twice.
 */
function stripSelfCoordPrefix(kind: number, pubkey: string, identifier: string): string {
  const prefix = `${kind}:${pubkey}:`.toLowerCase()
  let id = identifier
  while (id.toLowerCase().startsWith(prefix)) id = id.slice(prefix.length)
  return id
}

/**
 * Decode a note route param — a short address, or an `nevent1…`/`note1…`.
 *
 * Returns the event itself, since a note has no coordinate to look it up by
 * later: unlike a mod or blog it's a regular event, identified only by its id.
 */
export async function decodeNoteParam(
  param: string,
  relays: string[],
  fetchById: (id: string) => Promise<NostrEvent | null>,
): Promise<{ event: NostrEvent } | { candidates: NostrEvent[] } | null> {
  if (looksLikeShortAddress(param)) {
    const res = await resolveShortAddress(relays, param, dnnAuthorityToPubkey)
    // Ambiguity is surfaced rather than swallowed: two of an author's events
    // share a code and the address carried no selector, so only the reader can
    // say which one was meant.
    if (res.status === 'resolved') return { event: res.event }
    if (res.status === 'ambiguous') return { candidates: res.candidates }
    return null
  }
  try {
    const d = nip19.decode(param.replace(/^nostr:/i, ''))
    const id = d.type === 'nevent' ? d.data.id : d.type === 'note' ? (d.data as string) : null
    const ev = id ? await fetchById(id) : null
    return ev ? { event: ev } : null
  } catch {
    return null
  }
}

/**
 * The selector that distinguishes one candidate from the others — the next hex
 * characters of its hash, appended to an ambiguous address to make it exact.
 */
export function selectorFor(chosen: NostrEvent, others: NostrEvent[]): string {
  const mine = computeFullHash(chosen)
  const theirs = others.filter((e) => e.id !== chosen.id).map(computeFullHash)
  for (let n = SHORT_CODE_LENGTH + 1; n <= mine.length; n++) {
    const prefix = mine.slice(0, n)
    if (theirs.every((h) => !h.startsWith(prefix))) return mine.slice(SHORT_CODE_LENGTH, n)
  }
  return ''
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

  const filter = { authors: [pubkey], '#s': [parsed.code] }

  // Queried in small groups rather than all relays at once.
  //
  // One pooled subscription across every relay resolves as soon as all of them
  // have EOSE'd — and a relay that closes, never connects, or drops the request
  // counts as having answered. Typically a single relay holds the event, so
  // while the app is opening its other subscriptions that one relay's failure is
  // indistinguishable from "nobody has it", and the lookup reports not-found.
  // Small groups keep one relay's failure from speaking for the rest, and the
  // search stops at the first verified hit.
  const GROUP = 3
  let verified: NostrEvent[] = []
  for (let round = 0; round < 2 && verified.length === 0; round++) {
    for (let i = 0; i < relays.length; i += GROUP) {
      try {
        const events = await fetchEvents(relays.slice(i, i + GROUP), filter, 4000)
        const hits = events.filter(verifyShortCode)
        if (hits.length > 0) { verified = hits; break }
      } catch {
        // try the next group
      }
    }
  }
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
