import { LRUCache } from 'lru-cache'
import type { Event as NostrEvent } from 'nostr-tools'
import { idbStorage } from '@/lib/storage/idbStorage'
import { createPersister } from '@/lib/storage/persist'

/**
 * In-session cache of the latest raw addressable event (mods/blogs) by
 * coordinate. Populated whenever an event is parsed (list or detail), so opening
 * a post can render instantly from what a list already fetched, while a
 * background re-fetch checks for a newer version.
 *
 * Persisted to IndexedDB (newest N by created_at, debounced) so a full page
 * reload — including a deep-link straight to a mod/blog page — still paints from
 * cache instead of spinning. Consumers await `whenEventCacheReady` before their
 * first synchronous `getCachedEvent`, so the async hydration is in place.
 */
const cache = new LRUCache<string, NostrEvent>({ max: 2000 })

const PERSIST_KEY = 'event-cache-v1'
const PERSIST_MAX = 600 // cap persisted events so the blob stays a few MB
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // ignore a cache blob older than this

interface PersistShape {
  savedAt: number
  events: NostrEvent[]
}

export function coordOf(ev: NostrEvent): string {
  const d = ev.tags.find(t => t[0] === 'd')?.[1] ?? ''
  return `${ev.kind}:${ev.pubkey}:${d}`
}

// ── Persistence ─────────────────────────────────────────────────────

// Resolves once the IDB copy has been merged into the in-memory cache (or there
// was none). Cheap: a single IDB read. Read paths await this before the first
// getCachedEvent so a cold reload doesn't miss the persisted cache.
export const whenEventCacheReady: Promise<void> = (async () => {
  try {
    const raw = await idbStorage.getItem(PERSIST_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as PersistShape
    if (!parsed?.events || Date.now() - parsed.savedAt > MAX_AGE_MS) return
    // Insert so the newest per coordinate wins (same rule as cacheEvent).
    for (const e of parsed.events) {
      const coord = coordOf(e)
      const existing = cache.get(coord)
      if (!existing || e.created_at > existing.created_at) cache.set(coord, e)
    }
  } catch {
    // corrupt/absent cache is non-fatal — we just start empty.
  }
})()

const schedulePersist = createPersister(() => {
  try {
    // Newest PERSIST_MAX by created_at.
    const events = [...cache.values()]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, PERSIST_MAX)
    idbStorage.setItem(PERSIST_KEY, JSON.stringify({ savedAt: Date.now(), events } satisfies PersistShape))
  } catch {
    // serialization/quota failure is non-fatal.
  }
})

// ── Public API ──────────────────────────────────────────────────────

/** Cache an event as the latest for its coordinate (newer created_at wins). */
export function cacheEvent(ev: NostrEvent): void {
  const coord = coordOf(ev)
  const existing = cache.get(coord)
  if (!existing || ev.created_at > existing.created_at) {
    cache.set(coord, ev)
    schedulePersist()
  }
}

export function getCachedEvent(coord: string): NostrEvent | undefined {
  return cache.get(coord)
}

/**
 * Forget an event entirely.
 *
 * Used when its own author deletes it: a tombstone is normally cached like any
 * other revision (newer wins), but a relay that honours the deletion stops
 * serving the coordinate at all, so anything reading the cache would keep
 * resurrecting the pre-delete copy.
 */
export function forgetCachedEvent(coord: string): void {
  if (cache.delete(coord)) schedulePersist()
}
