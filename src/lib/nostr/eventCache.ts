import { LRUCache } from 'lru-cache'
import type { Event as NostrEvent } from 'nostr-tools'

/**
 * In-session cache of the latest raw addressable event (mods/blogs) by
 * coordinate. Populated whenever an event is parsed (list or detail), so opening
 * a post can render instantly from what a list already fetched, while a
 * background re-fetch checks for a newer version.
 */
const cache = new LRUCache<string, NostrEvent>({ max: 2000 })

export function coordOf(ev: NostrEvent): string {
  const d = ev.tags.find(t => t[0] === 'd')?.[1] ?? ''
  return `${ev.kind}:${ev.pubkey}:${d}`
}

/** Cache an event as the latest for its coordinate (newer created_at wins). */
export function cacheEvent(ev: NostrEvent): void {
  const coord = coordOf(ev)
  const existing = cache.get(coord)
  if (!existing || ev.created_at > existing.created_at) cache.set(coord, ev)
}

export function getCachedEvent(coord: string): NostrEvent | undefined {
  return cache.get(coord)
}
