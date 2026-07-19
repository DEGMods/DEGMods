import { useState, useEffect, useRef, useCallback } from 'react'
import type { Filter, Event as NostrEvent } from 'nostr-tools'
import { fetchEventsWithSearch } from '@/lib/nostr/searchFetch'
import { constructModListFromEvents } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { beginRefresh, endRefresh } from '@/lib/ui/refreshToast'
import { idbStorage } from '@/lib/storage/idbStorage'
import { createPersister } from '@/lib/storage/persist'
import type { ModDetails } from '@/types/mod'

const DEFAULT_BATCH = 100
// How long a cached first page is considered fresh enough to skip revalidation.
const PROG_TTL = 60 * 1000
// Bounded LRU so visiting many games/profiles in a session can't grow unbounded.
const PROG_CACHE_MAX = 16

// Persistence (IndexedDB): only the most-recent filters, capped events each, so
// a full reload of /mods, /game, /profile paints instantly instead of spinning.
const PROG_KEY = 'prog-mods-cache-v1'
const PROG_PERSIST_FILTERS = 6
const PROG_PERSIST_EVENTS = 150
const PROG_MAX_AGE_MS = 6 * 60 * 60 * 1000

interface ProgCacheEntry {
  at: number
  raw: NostrEvent[]
  oldest: number | undefined
}

// Cache of loaded events per filter (keyed by the JSON filter), so returning to
// a list page paints instantly and revalidates in the background instead of
// flashing skeletons.
const progCache = new Map<string, ProgCacheEntry>()

function cacheGet(key: string): ProgCacheEntry | undefined {
  const entry = progCache.get(key)
  if (entry) {
    progCache.delete(key)
    progCache.set(key, entry) // bump recency (Map keeps insertion order)
  }
  return entry
}

function cacheSet(key: string, entry: ProgCacheEntry): void {
  progCache.delete(key)
  progCache.set(key, entry)
  while (progCache.size > PROG_CACHE_MAX) {
    const oldestKey = progCache.keys().next().value
    if (oldestKey === undefined) break
    progCache.delete(oldestKey)
  }
  schedulePersist()
}

/**
 * Drop every copy of one addressable event from the listing caches.
 *
 * Deleting a mod publishes a tombstone, but these caches hold the *pre-delete*
 * event and are only revalidated on a timer — and revalidation can't help here
 * anyway, since a relay that honoured the deletion simply stops returning the
 * coordinate at all, leaving the cached copy as the newest thing we ever saw.
 * So the deleted event has to be evicted explicitly, or the mod keeps appearing
 * in listings long after its own page reports it gone.
 */
export function purgeFromModCaches(pubkey: string, dTag: string): void {
  let changed = false
  for (const [key, entry] of progCache.entries()) {
    const raw = entry.raw.filter((e) => !(e.pubkey === pubkey && (e.tags.find((t) => t[0] === 'd')?.[1] ?? '') === dTag))
    if (raw.length !== entry.raw.length) {
      progCache.set(key, { ...entry, raw })
      changed = true
    }
  }
  if (changed) schedulePersist()
}

// Hydrate the most-recent filters from IndexedDB. Read paths await this before
// deciding cache-vs-skeleton so a cold reload doesn't miss the persisted copy.
let progHydrated = false
const whenProgReady: Promise<void> = (async () => {
  try {
    const raw = await idbStorage.getItem(PROG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { savedAt: number; filters: [string, ProgCacheEntry][] }
      if (parsed?.filters && Date.now() - parsed.savedAt <= PROG_MAX_AGE_MS) {
        for (const [key, entry] of parsed.filters) progCache.set(key, entry)
      }
    }
  } catch {
    // corrupt/absent cache is non-fatal.
  }
  progHydrated = true
})()

const schedulePersist = createPersister(() => {
  try {
    // Most-recently-used filters (Map keeps insertion order), newest first page
    // of each, so the blob stays a few MB.
    const filters = [...progCache.entries()]
      .slice(-PROG_PERSIST_FILTERS)
      .map(([key, v]): [string, ProgCacheEntry] => [
        key,
        { at: v.at, oldest: v.oldest, raw: v.raw.slice(0, PROG_PERSIST_EVENTS) },
      ])
    idbStorage.setItem(PROG_KEY, JSON.stringify({ savedAt: Date.now(), filters }))
  } catch {
    // serialization/quota failure is non-fatal.
  }
})

/**
 * Progressively fetches mods for a given base filter. The first batch loads on
 * mount (or whenever the filter changes); calling `loadMore()` fetches an older
 * batch using an `until` cursor based on the oldest event seen so far, appending
 * and de-duplicating. Pages on the consuming page therefore grow as more mods
 * arrive. `reachedEnd` flips true once a batch returns no new events.
 *
 * Results are cached per filter for the session: revisiting a list paints the
 * cached mods instantly (no skeletons) and revalidates in the background behind
 * a "Checking for updates…" toast, updating in place if anything new arrives.
 */
export function useProgressiveMods(baseFilter: Filter, batch: number = DEFAULT_BATCH) {
  const filterKey = JSON.stringify(baseFilter)
  const filterRef = useRef(baseFilter)
  filterRef.current = baseFilter
  const filterKeyRef = useRef(filterKey)
  filterKeyRef.current = filterKey

  const [mods, setMods] = useState<ModDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reachedEnd, setReachedEnd] = useState(false)

  const rawRef = useRef<NostrEvent[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const oldestRef = useRef<number | undefined>(undefined)
  const inFlightRef = useRef(false)

  // Ingest raw events: de-dupe by id, track the oldest created_at, rebuild list.
  const ingest = useCallback((events: NostrEvent[]): number => {
    let fresh = 0
    for (const e of events) {
      if (seenRef.current.has(e.id)) continue
      seenRef.current.add(e.id)
      rawRef.current.push(e)
      fresh++
      if (oldestRef.current === undefined || e.created_at < oldestRef.current) {
        oldestRef.current = e.created_at
      }
    }
    if (fresh > 0) setMods(constructModListFromEvents(rawRef.current))
    return fresh
  }, [])

  // Reset/seed + initial (or background) load whenever the base filter changes.
  useEffect(() => {
    let cancelled = false

    const seedAndFetch = () => {
      const cached = cacheGet(filterKey)
      if (cached) {
        // Paint the cached page instantly; no skeletons on return/reload.
        rawRef.current = cached.raw.slice()
        seenRef.current = new Set(cached.raw.map((e) => e.id))
        oldestRef.current = cached.oldest
        setMods(constructModListFromEvents(rawRef.current))
        setReachedEnd(false)
        setLoading(false)
      } else {
        rawRef.current = []
        seenRef.current = new Set()
        oldestRef.current = undefined
        setMods([])
        setReachedEnd(false)
        setLoading(true)
      }
      inFlightRef.current = false

      // Fresh cache: skip the network entirely. Otherwise fetch — in the
      // background (no skeletons, toast) when we already have something to show.
      const fresh = cached && Date.now() - cached.at < PROG_TTL
      if (fresh) return
      const background = !!cached
      ;(async () => {
        const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        if (background) beginRefresh()
        try {
          const events = await fetchEventsWithSearch(relayUrls, { ...filterRef.current, limit: batch }, 10000)
          if (cancelled) return
          ingest(events)
          cacheSet(filterKey, { at: Date.now(), raw: rawRef.current.slice(), oldest: oldestRef.current })
        } catch {
          // silently fail
        } finally {
          if (background) endRefresh()
          else if (!cancelled) setLoading(false)
        }
      })()
    }

    if (progHydrated) {
      seedAndFetch()
    } else {
      // Cold reload: keep skeletons until the IndexedDB copy is loaded, then
      // decide cache-vs-fetch (a quick single IDB read).
      setMods([])
      setReachedEnd(false)
      setLoading(true)
      whenProgReady.then(() => { if (!cancelled) seedAndFetch() })
    }

    return () => { cancelled = true }
  }, [filterKey, batch, ingest])

  const loadMore = useCallback(async () => {
    if (inFlightRef.current || reachedEnd || oldestRef.current === undefined) return
    inFlightRef.current = true
    setLoadingMore(true)
    const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    try {
      const events = await fetchEventsWithSearch(
        relayUrls,
        { ...filterRef.current, until: oldestRef.current - 1, limit: batch },
        10000,
      )
      const fresh = ingest(events)
      // Cache the grown page set, preserving the first-page freshness timestamp
      // so revisits still revalidate the newest mods rather than skipping.
      const prev = progCache.get(filterKeyRef.current)
      cacheSet(filterKeyRef.current, {
        at: prev?.at ?? Date.now(),
        raw: rawRef.current.slice(),
        oldest: oldestRef.current,
      })
      if (fresh === 0) setReachedEnd(true)
    } catch {
      // silently fail
    } finally {
      inFlightRef.current = false
      setLoadingMore(false)
    }
  }, [reachedEnd, batch, ingest])

  return { mods, loading, loadingMore, reachedEnd, loadMore }
}
