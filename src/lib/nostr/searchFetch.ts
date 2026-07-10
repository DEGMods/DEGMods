import type { Filter, Event as NostrEvent } from 'nostr-tools'
import { fetchEvents } from './relay-pool'
import { useRelayCapabilityStore } from '@/stores/relayCapabilityStore'

/**
 * Fetch events honoring a NIP-50 `search` term across a mixed relay set.
 *
 * Relays that support NIP-50 (per the cached probe) get the full filter — the
 * relay does the matching. The rest get the filter WITHOUT `search` and are
 * matched client-side (substring on title/content), since they can't search.
 * Results are merged; the caller de-dupes by id.
 */
export async function fetchEventsWithSearch(
  relayUrls: string[],
  filter: Filter,
  timeoutMs?: number,
): Promise<NostrEvent[]> {
  const term = filter.search?.trim()
  if (!term) return fetchEvents(relayUrls, filter, timeoutMs)

  const { search, other } = useRelayCapabilityStore.getState().splitBySearch(relayUrls)
  const noSearch: Filter = { ...filter }
  delete noSearch.search

  const [searchEvents, otherEvents] = await Promise.all([
    search.length ? fetchEvents(search, filter, timeoutMs).catch(() => [] as NostrEvent[]) : Promise.resolve([] as NostrEvent[]),
    other.length ? fetchEvents(other, noSearch, timeoutMs).catch(() => [] as NostrEvent[]) : Promise.resolve([] as NostrEvent[]),
  ])

  const lc = term.toLowerCase()
  const matches = (e: NostrEvent) => {
    const title = e.tags.find(t => t[0] === 'title')?.[1] ?? ''
    return title.toLowerCase().includes(lc) || e.content.toLowerCase().includes(lc)
  }
  // Trust relay-side search results; substring-filter the non-search relays.
  return [...searchEvents, ...otherEvents.filter(matches)]
}
