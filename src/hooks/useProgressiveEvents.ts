import { useState, useEffect, useRef, useCallback } from 'react'
import type { Filter, Event as NostrEvent } from 'nostr-tools'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Progressively fetches raw events for a filter, newest first. Like
 * useProgressiveMods but returns the raw events (deduped by id) so the caller
 * can map them (blogs, social notes, etc.). Calling loadMore() pulls an older
 * batch via an `until` cursor.
 */
export function useProgressiveEvents(baseFilter: Filter, batch: number = 50) {
  const filterKey = JSON.stringify(baseFilter)
  const filterRef = useRef(baseFilter)
  filterRef.current = baseFilter

  const [events, setEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reachedEnd, setReachedEnd] = useState(false)

  const rawRef = useRef<NostrEvent[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const oldestRef = useRef<number | undefined>(undefined)
  const inFlightRef = useRef(false)

  const ingest = useCallback((evs: NostrEvent[]): number => {
    let fresh = 0
    for (const e of evs) {
      if (seenRef.current.has(e.id)) continue
      seenRef.current.add(e.id)
      rawRef.current.push(e)
      fresh++
      if (oldestRef.current === undefined || e.created_at < oldestRef.current) oldestRef.current = e.created_at
    }
    if (fresh > 0) setEvents([...rawRef.current].sort((a, b) => b.created_at - a.created_at))
    return fresh
  }, [])

  useEffect(() => {
    let cancelled = false
    rawRef.current = []
    seenRef.current = new Set()
    oldestRef.current = undefined
    inFlightRef.current = false
    setEvents([])
    setReachedEnd(false)
    setLoading(true)
    ;(async () => {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      try {
        const evs = await fetchEvents(relays, { ...filterRef.current, limit: batch }, 8000)
        if (!cancelled) ingest(evs)
      } catch {
        // ignore
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
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    try {
      const evs = await fetchEvents(relays, { ...filterRef.current, until: oldestRef.current - 1, limit: batch }, 8000)
      const fresh = ingest(evs)
      if (fresh === 0) setReachedEnd(true)
    } catch {
      // ignore
    } finally {
      inFlightRef.current = false
      setLoadingMore(false)
    }
  }, [reachedEnd, batch, ingest])

  return { events, loading, loadingMore, reachedEnd, loadMore }
}
