/**
 * MODERATION TAGGING EVENT — kind 30985
 * ─────────────────────────────────────────────────────────────────────────
 * An addressable "overlay" that applies tags to a post someone else wrote.
 *
 * A Nostr event is signed by its author, so nobody can edit it after the fact.
 * When an author forgets to mark a mod NSFW, or doesn't declare it as a repost,
 * the only honest option is a *separate* event that says "treat that post as if
 * it carried these tags", which readers merge in at render time.
 *
 * The envelope is addressing only — `d`, `a`/`e`, `k`, `L`. **Every other tag is
 * payload**, applied verbatim to the target. That makes this general purpose:
 * any client can attach any tag it understands, not just the two DEG MODS reads.
 *
 *   ["d", "31142:<pubkey>:<d>"]   addressable key — the target
 *   ["a", "31142:<pubkey>:<d>"]   target pointer (or ["e", "<id>"])
 *   ["k", "31142"]                target kind
 *   ["L", "moderation"]           NIP-32 namespace (see below)
 *   ["content-warning", "nsfw"]   ← payload, same spelling a mod uses
 *   ["repost", "true", "<who>"]   ← payload, same spelling a mod uses
 *
 * Because `d` is the target, the event is *replaceable per post*: re-tagging
 * overwrites, and un-tagging means republishing without that tag. Deletion
 * (kind 5) is deliberately not used — relays don't reliably drop tombstones, so
 * a "cleared" overlay that still exists is far more dependable than one that
 * was asked to disappear.
 *
 * `L: moderation` is legitimate here rather than a hijack: NIP-32's
 * self-reporting rule says `l`/`L` on kinds *other than* 1985 label the event
 * itself — so this reads as "this overlay is a moderation action", and
 * `#L:["moderation"]` lists everything an author has ever tagged.
 *
 * Payload tag names deliberately mirror what a mod event itself uses
 * (see extractModData), so the same reader parses both.
 */
import { nip19, type Event as NostrEvent, type UnsignedEvent } from 'nostr-tools'
import { KINDS } from '@/lib/constants'
import { LEGACY_MOD_KIND } from '@/lib/mods/legacy' // LEGACY

/** Value of the `L` namespace tag — what makes an overlay a moderation action. */
export const MODERATION_NAMESPACE = 'moderation'

/** Kinds whose identity is a coordinate rather than an event id. */
const ADDRESSABLE = new Set<number>([
  KINDS.MOD, LEGACY_MOD_KIND, KINDS.BLOG, KINDS.JAM,
])

/** The flags DEG MODS reads off an overlay. Other clients may read others. */
export interface ModerationOverlay {
  /** Present ⇒ treat the target as NSFW. The value is the reason shown. */
  contentWarning?: string
  isRepost?: boolean
  /** Who the original is credited to — npub, name, or link. */
  originalAuthor?: string
  /** created_at of the overlay, for last-write-wins across relay copies. */
  updatedAt: number
}

export interface OverlayTarget {
  /** The `d` value: a coordinate for addressable kinds, else the event id. */
  key: string
  /** Pointer tag: ['a', coord] for addressable, ['e', id] otherwise. */
  pointer: ['a', string] | ['e', string]
  kind?: number
}

/** True when the overlay carries no flags at all — i.e. the target is clear. */
export function isEmptyOverlay(o: ModerationOverlay): boolean {
  return !o.contentWarning && !o.isRepost
}

/**
 * Work out what a pasted address points at.
 *
 * Accepts naddr / nevent / note, and raw forms (a `kind:pubkey:d` coordinate or
 * a bare 64-char event id) so an admin can paste whatever they have to hand.
 */
export function parseOverlayTarget(input: string): OverlayTarget | { error: string } {
  const value = input.trim()
  if (!value) return { error: 'Enter an naddr, nevent, or note address' }

  // Raw coordinate, e.g. 31142:<pubkey>:<d>
  const coordMatch = /^(\d+):([0-9a-f]{64}):(.*)$/i.exec(value)
  if (coordMatch) {
    return { key: value, pointer: ['a', value], kind: Number(coordMatch[1]) }
  }

  // Raw event id
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return { key: value.toLowerCase(), pointer: ['e', value.toLowerCase()] }
  }

  try {
    const decoded = nip19.decode(value)
    if (decoded.type === 'naddr') {
      const { kind, pubkey, identifier } = decoded.data
      const coord = `${kind}:${pubkey}:${identifier}`
      return { key: coord, pointer: ['a', coord], kind }
    }
    if (decoded.type === 'nevent') {
      const id = decoded.data.id
      return { key: id, pointer: ['e', id], kind: decoded.data.kind }
    }
    if (decoded.type === 'note') {
      return { key: decoded.data, pointer: ['e', decoded.data] }
    }
    return { error: 'That address doesn\'t point at a post' }
  } catch {
    return { error: 'Not a valid Nostr address' }
  }
}

/** Best-effort display address for a target key, for links back to the post. */
export function targetAddress(key: string, kind?: number): string | null {
  const coord = /^(\d+):([0-9a-f]{64}):(.*)$/i.exec(key)
  try {
    if (coord) {
      return nip19.naddrEncode({
        kind: Number(coord[1]), pubkey: coord[2], identifier: coord[3],
      })
    }
    return nip19.neventEncode(kind ? { id: key, kind } : { id: key })
  } catch {
    return null
  }
}

/** True when this target is a mod (current or legacy), so it links to /mod. */
export function isModTarget(key: string): boolean {
  const kind = Number(key.split(':')[0])
  return kind === KINDS.MOD || kind === LEGACY_MOD_KIND
}

/** Build the unsigned overlay event. Omitted flags simply aren't tagged. */
export function buildModerationTagEvent(
  target: OverlayTarget,
  overlay: Pick<ModerationOverlay, 'contentWarning' | 'isRepost' | 'originalAuthor'>,
): UnsignedEvent {
  const tags: string[][] = [
    ['d', target.key],
    target.pointer,
    ['L', MODERATION_NAMESPACE],
  ]
  // Prefer the explicit kind; fall back to the one encoded in a coordinate.
  const kind = target.kind ?? (ADDRESSABLE.size ? Number(target.key.split(':')[0]) : NaN)
  if (Number.isFinite(kind) && kind > 0) tags.push(['k', String(kind)])

  // Payload — deliberately spelled exactly as a mod event spells them.
  if (overlay.contentWarning) tags.push(['content-warning', overlay.contentWarning])
  if (overlay.isRepost) {
    tags.push(overlay.originalAuthor
      ? ['repost', 'true', overlay.originalAuthor]
      : ['repost', 'true'])
  }

  return {
    kind: KINDS.MODERATION_TAG,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
    pubkey: '', // filled in at signing
  }
}

/** Read an overlay event back. Returns null when it isn't a usable overlay. */
export function parseModerationTagEvent(
  event: NostrEvent,
): { key: string; kind?: number; overlay: ModerationOverlay } | null {
  const key = event.tags.find((t) => t[0] === 'd')?.[1]
  if (!key) return null

  const contentWarning = event.tags.find((t) => t[0] === 'content-warning')?.[1]
  const repostTag = event.tags.find((t) => t[0] === 'repost')
  const isRepost = repostTag?.[1] === 'true'
  const kindTag = event.tags.find((t) => t[0] === 'k')?.[1]

  return {
    key,
    kind: kindTag ? Number(kindTag) : undefined,
    overlay: {
      // An empty value means "no longer flagged" — same as the tag being absent.
      contentWarning: contentWarning || undefined,
      isRepost,
      originalAuthor: isRepost ? repostTag?.[2] : undefined,
      updatedAt: event.created_at,
    },
  }
}

/**
 * Collapse relay copies to one overlay per target, newest wins.
 *
 * Addressable events can come back in several revisions from different relays;
 * without this an older "cleared" copy could beat the current flag.
 */
export function latestPerTarget(events: NostrEvent[]): Map<string, ModerationOverlay> {
  const out = new Map<string, ModerationOverlay>()
  for (const event of events) {
    const parsed = parseModerationTagEvent(event)
    if (!parsed) continue
    const existing = out.get(parsed.key)
    if (!existing || parsed.overlay.updatedAt > existing.updatedAt) {
      out.set(parsed.key, parsed.overlay)
    }
  }
  return out
}
