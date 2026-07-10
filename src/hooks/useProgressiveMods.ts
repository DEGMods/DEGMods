import { useState, useEffect, useRef, useCallback } from 'react'
import type { Filter, Event as NostrEvent } from 'nostr-tools'
import { fetchEventsWithSearch } from '@/lib/nostr/searchFetch'
import { constructModListFromEvents } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ModDetails } from '@/types/mod'

const DEFAULT_BATCH = 100

/**
 * Progressively fetches mods for a given base filter. The first batch loads on
 * mount (or whenever the filter changes); calling `loadMore()` fetches an older
 * batch using an `until` cursor based on the oldest event seen so far, appending
 * and de-duplicating. Pages on the consuming page therefore grow as more mods
 * arrive. `reachedEnd` flips true once a batch returns no new events.
 */
export function useProgressiveMods(baseFilter: Filter, batch: number = DEFAULT_BATCH) {
  const filterKey = JSON.stringify(baseFilter)
  const filterRef = useRef(baseFilter)
  filterRef.current = baseFilter

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

  // Reset + initial load whenever the base filter changes.
  useEffect(() => {
    let cancelled = false
    rawRef.current = []
    seenRef.current = new Set()
    oldestRef.current = undefined
    inFlightRef.current = false
    setMods([])
    setReachedEnd(false)
    setLoading(true)

    ;(async () => {
      const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      try {
        const events = await fetchEventsWithSearch(relayUrls, { ...filterRef.current, limit: batch }, 10000)
        if (cancelled) return
        ingest(events)
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

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
