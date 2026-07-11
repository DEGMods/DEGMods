import { useState, useEffect, useRef, useCallback } from 'react'
import type { Filter, Event as NostrEvent } from 'nostr-tools'
import { fetchEventsWithSearch } from '@/lib/nostr/searchFetch'
import { constructModListFromEvents } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { beginRefresh, endRefresh } from '@/lib/ui/refreshToast'
import type { ModDetails } from '@/types/mod'

const DEFAULT_BATCH = 100
// How long a cached first page is considered fresh enough to skip revalidation.
const PROG_TTL = 60 * 1000
// Bounded LRU so visiting many games/profiles in a session can't grow unbounded.
const PROG_CACHE_MAX = 16

interface ProgCacheEntry {
  at: number
  raw: NostrEvent[]
  oldest: number | undefined
}

// In-memory (per session) cache of loaded events per filter, so returning to a
// list page paints instantly and revalidates in the background instead of
// flashing skeletons. Keyed by the JSON filter; not persisted (lists can be big).
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
}

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
    const cached = cacheGet(filterKey)

    if (cached) {
      // Paint the cached page instantly; no skeletons on return.
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
    if (!fresh) {
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
