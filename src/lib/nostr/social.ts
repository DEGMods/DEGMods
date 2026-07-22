/**
 * Social helpers: reactions (kind 7), comments (kind 1111, NIP-22),
 * and zap receipts (kind 9735, NIP-57) fetching/parsing.
 */

import type { UnsignedEvent, Event as NostrEvent } from 'nostr-tools'
import { fetchEvents } from './relay-pool'
import { countLeadingZeroBits } from '@/lib/pow/pow'
import { LEGACY_MOD_KIND } from '@/lib/mods/legacy' // LEGACY

/**
 * A reference to any Nostr event that can be reacted to / commented on / zapped.
 * `aTag` is the addressable coordinate (`<kind>:<pubkey>:<d>`) for replaceable
 * events (mods, blogs); regular events (comments) only have an `id`.
 */
export interface NostrTarget {
  id: string
  pubkey: string
  kind: number
  aTag?: string
}

const now = () => Math.floor(Date.now() / 1000)

// ─── Reactions (kind 7) ──────────────────────────────────────────────

export function buildReactionEvent(target: NostrTarget, content = '+'): UnsignedEvent {
  const tags: string[][] = []
  if (target.aTag) tags.push(['a', target.aTag])
  tags.push(['e', target.id])
  tags.push(['p', target.pubkey])
  tags.push(['k', target.kind.toString()])
  return { kind: 7, content, tags, created_at: now(), pubkey: '' }
}

/** A kind 5 deletion request that removes the user's own reaction event. */
export function buildReactionDeletion(reactionId: string): UnsignedEvent {
  return { kind: 5, content: '', tags: [['e', reactionId]], created_at: now(), pubkey: '' }
}

export async function fetchReactions(relays: string[], target: NostrTarget): Promise<NostrEvent[]> {
  const filter = target.aTag
    ? { kinds: [7], '#a': [target.aTag] }
    : { kinds: [7], '#e': [target.id] }
  return fetchEvents(relays, filter, 5000)
}

export interface ReactionSummary {
  count: number
  /** The current user's active reaction event, if any. */
  mine: NostrEvent | null
}

export type ReactionBucket = 'positive' | 'negative'

// Explicitly negative reaction contents (everything else is treated as positive,
// since likes dominate and NIP-25 uses `+`/empty for a like).
const NEGATIVE_REACTIONS = new Set([
  '-', '👎', '💩', '💀', '☠️', '☠', '🤮', '🤢', '🤡', '😡', '😠', '🤬', '😤',
  '😒', '🙄', '😞', '😔', '😟', '😕', '🙁', '☹️', '☹', '😣', '😖', '😫', '😩',
  '😢', '😭', '💔', '🥴', '😬', '🖕',
])

/**
 * Classify any reaction `content` into a positive or negative bucket, so that
 * reactions from other clients (skull, barf, smile, laugh, …) still aggregate
 * into our two buttons. Unknown content defaults to positive.
 */
export function classifyReaction(content: string): ReactionBucket {
  return NEGATIVE_REACTIONS.has(content.trim()) ? 'negative' : 'positive'
}

/**
 * Reduce raw reaction events to a count for a bucket (positive/negative) and the
 * current user's matching reaction. Keeps one reaction per author (latest).
 */
export function summarizeReactions(
  events: NostrEvent[],
  myPubkey: string | null,
  bucket: ReactionBucket = 'positive',
): ReactionSummary {
  const latestByAuthor = new Map<string, NostrEvent>()
  for (const ev of events) {
    if (classifyReaction(ev.content) !== bucket) continue
    const prev = latestByAuthor.get(ev.pubkey)
    if (!prev || ev.created_at > prev.created_at) latestByAuthor.set(ev.pubkey, ev)
  }
  let count = 0
  let mine: NostrEvent | null = null
  for (const ev of latestByAuthor.values()) {
    count++
    if (myPubkey && ev.pubkey === myPubkey) mine = ev
  }
  return { count, mine }
}

// ─── Comments (kind 1111, NIP-22) ────────────────────────────────────

export interface CommentNode {
  event: NostrEvent
  pow: number
  replies: CommentNode[]
}

export async function fetchComments(relays: string[], root: NostrTarget): Promise<NostrEvent[]> {
  // Root scope uses uppercase tags: `A` for addressable roots, `E` otherwise.
  const filter = root.aTag
    ? { kinds: [1111], '#A': [root.aTag] }
    : { kinds: [1111], '#E': [root.id] }

  // LEGACY: comments on the old site predate NIP-22 — they're plain kind-1
  // notes carrying the mod's coordinate in a lowercase `a` tag. Nothing here
  // ever matched them, so every legacy mod looked like it had no discussion
  // while the old site still showed it.
  //
  // Only asked for under a legacy root. Current mods never accumulated kind-1
  // comments, so widening the query there would add nothing but a way to put
  // unmoderated notes under a post.
  if (root.kind !== LEGACY_MOD_KIND || !root.aTag) return fetchEvents(relays, filter, 6000)

  const [modern, legacy] = await Promise.all([
    fetchEvents(relays, filter, 6000),
    fetchEvents(relays, { kinds: [1], '#a': [root.aTag] }, 6000),
  ])
  return [...modern, ...legacy] // deduped by id in buildCommentTree
}

/** Direct-parent event id of a comment (the lowercase `e` tag), or null if it replies to the root. */
function parentIdOf(event: NostrEvent): string | null {
  return event.tags.find(t => t[0] === 'e')?.[1] ?? null
}

/**
 * Build a threaded comment tree from a flat list, filtering out events whose
 * PoW is below `minPow`. Replies whose parent was filtered out (or isn't
 * present) are promoted to top level so they remain visible.
 */
export function buildCommentTree(events: NostrEvent[], minPow = 0, powExempt?: Set<string>): CommentNode[] {
  // Dedupe by id, drop deleted + below-threshold.
  const byId = new Map<string, NostrEvent>()
  for (const ev of events) {
    if (ev.tags.some(t => t[0] === 'deleted' && t[1] === 'true')) continue
    byId.set(ev.id, ev)
  }

  const nodes = new Map<string, CommentNode>()
  for (const ev of byId.values()) {
    const pow = countLeadingZeroBits(ev.id)
    // People you follow (and yourself) bypass the PoW content filter, and so do
    // legacy kind-1 comments: they were written before this client mined any
    // work, so they measure 0-2 bits against a default threshold of 15 and the
    // filter would hide every one of them. Same exemption legacy mods already
    // get in applyModFilters, and equally bounded — kind-1 events only reach
    // this tree under a legacy root (see fetchComments).
    if (pow < minPow && ev.kind !== 1 && !powExempt?.has(ev.pubkey)) continue
    nodes.set(ev.id, { event: ev, pow, replies: [] })
  }

  const roots: CommentNode[] = []
  for (const node of nodes.values()) {
    const parentId = parentIdOf(node.event)
    const parent = parentId ? nodes.get(parentId) : null
    if (parent && parent !== node) parent.replies.push(node)
    else roots.push(node)
  }

  const sortRec = (list: CommentNode[]) => {
    list.sort((a, b) => a.event.created_at - b.event.created_at)
    list.forEach(n => sortRec(n.replies))
  }
  sortRec(roots)
  return roots
}

export function countComments(nodes: CommentNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countComments(n.replies), 0)
}

/**
 * The ancestry path of a comment within the tree, from its top-level ancestor
 * down to the comment itself (inclusive). Returns null if not found. Used to
 * seed the thread modal's navigation stack so the back button walks up replies.
 */
export function findCommentPath(nodes: CommentNode[], id: string): string[] | null {
  for (const n of nodes) {
    if (n.event.id === id) return [id]
    const sub = findCommentPath(n.replies, id)
    if (sub) return [n.event.id, ...sub]
  }
  return null
}

// ─── Zap receipts (kind 9735, NIP-57) ────────────────────────────────

export async function fetchZapReceipts(relays: string[], target: NostrTarget): Promise<NostrEvent[]> {
  const filter = target.aTag
    ? { kinds: [9735], '#a': [target.aTag] }
    : { kinds: [9735], '#e': [target.id] }
  return fetchEvents(relays, filter, 5000)
}

/** Extract the zapped amount (in millisats) from a zap receipt's embedded request. */
export function zapReceiptAmountMsat(receipt: NostrEvent): number {
  const desc = receipt.tags.find(t => t[0] === 'description')?.[1]
  if (!desc) return 0
  try {
    const req = JSON.parse(desc) as { tags?: string[][] }
    const amount = req.tags?.find(t => t[0] === 'amount')?.[1]
    return amount ? parseInt(amount, 10) || 0 : 0
  } catch {
    return 0
  }
}

/** Sum zap receipts and return total sats (rounded down). */
export function totalZapSats(receipts: NostrEvent[]): number {
  const msat = receipts.reduce((sum, r) => sum + zapReceiptAmountMsat(r), 0)
  return Math.floor(msat / 1000)
}
