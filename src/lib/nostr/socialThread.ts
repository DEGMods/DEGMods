/**
 * Kind-1 social threading (NIP-10).
 *
 * Social posts and their replies are plain kind-1 notes linked with `e` tags,
 * the way most Nostr clients do it — so replies authored elsewhere show up here
 * (and ours show up there). This is separate from the NIP-22 (kind 1111)
 * comment system used for mods and blogs.
 */

import type { Event as NostrEvent, UnsignedEvent } from 'nostr-tools'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { CLIENT_NAME } from '@/lib/constants'

/** Fetch kind-1 events that reference `eventId` via an `e` tag. */
export async function fetchReplies(relayUrls: string[], eventId: string): Promise<NostrEvent[]> {
  return fetchEvents(relayUrls, { kinds: [1], '#e': [eventId], limit: 200 }, 6000)
}

/** Resolve a reply's immediate parent id per NIP-10 (marked, else positional). */
export function replyParentId(event: NostrEvent): string | null {
  const eTags = event.tags.filter((t) => t[0] === 'e' && t[1])
  if (eTags.length === 0) return null
  const reply = eTags.find((t) => t[3] === 'reply')
  if (reply) return reply[1]
  const root = eTags.find((t) => t[3] === 'root')
  if (root) return root[1] // only a root marker → the parent is the root
  if (eTags.length === 1) return eTags[0][1]
  // Deprecated positional form: last e tag is the reply target.
  return eTags[eTags.length - 1][1]
}

/** Direct replies of `parentId` from a fetched batch, deduped + sorted oldest-first. */
export function directReplies(events: NostrEvent[], parentId: string): NostrEvent[] {
  const byId = new Map<string, NostrEvent>()
  for (const e of events) byId.set(e.id, e)
  return Array.from(byId.values())
    .filter((e) => replyParentId(e) === parentId)
    .sort((a, b) => a.created_at - b.created_at)
}

export interface SocialRef { id: string; pubkey: string }

/** Build a top-level kind-1 social post. */
export function buildSocialPost(content: string): UnsignedEvent {
  return {
    kind: 1,
    content,
    tags: [['client', CLIENT_NAME]],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

/** Classify a feed event for the reposts / quotes / replies toggles. */
export function classifyPost(event: NostrEvent): 'root' | 'repost' | 'quote-repost' | 'reply' {
  if (event.kind === 6) return 'repost'
  const hasQuote = event.tags.some((t) => t[0] === 'q')
  if (hasQuote) return 'quote-repost'
  const hasReply = event.tags.some((t) => t[0] === 'e')
  if (hasReply) return 'reply'
  return 'root'
}

/** Parse the reposted note embedded in a kind-6 event's content (NIP-18). */
export function parseRepostInner(event: NostrEvent): NostrEvent | null {
  if (!event.content) return null
  try {
    const inner = JSON.parse(event.content)
    if (inner && typeof inner.id === 'string' && typeof inner.pubkey === 'string') return inner as NostrEvent
  } catch {
    // not embedded
  }
  return null
}

/** Build a NIP-10 kind-1 reply. `parent` omitted (or equal to root) = direct reply to root. */
export function buildSocialReply(content: string, root: SocialRef, parent?: SocialRef): UnsignedEvent {
  const tags: string[][] = []
  if (parent && parent.id !== root.id) {
    tags.push(['e', root.id, '', 'root'])
    tags.push(['e', parent.id, '', 'reply'])
    tags.push(['p', root.pubkey])
    if (parent.pubkey !== root.pubkey) tags.push(['p', parent.pubkey])
  } else {
    tags.push(['e', root.id, '', 'root'])
    tags.push(['p', root.pubkey])
  }
  tags.push(['client', CLIENT_NAME])
  return { kind: 1, content, tags, created_at: Math.floor(Date.now() / 1000), pubkey: '' }
}
