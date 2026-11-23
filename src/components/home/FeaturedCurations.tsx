import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { Event as NostrEvent } from 'nostr-tools'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchEvent, fetchEvents } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { extractBounty, FEATURED_REQUESTS_DTAG, type BountyDetails } from '@/lib/nostr/bounty'
import { extractJam, FEATURED_JAMS_DTAG, type JamDetails } from '@/lib/nostr/jam'
import { BountyCard } from '@/components/mod/BountyCard'
import { JamCard } from '@/components/jam/JamCard'

/**
 * Resolve an admin NIP-78 list (by d-tag) of `a`-coordinates into the newest
 * event per coordinate, preserving the admin's chosen order. Shared by the two
 * curated home-page rails below.
 */
async function resolveCuratedList<T extends { aTag: string; createdAt: number }>(
  dTag: string,
  kind: number,
  extract: (ev: NostrEvent) => T | null,
): Promise<T[]> {
  const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
  const listEv = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [dTag] })
  const coords = (listEv?.tags ?? []).filter((t) => t[0] === 'a').map((t) => t[1]).filter(Boolean)
  if (coords.length === 0) return []

  const authors = [...new Set(coords.map((c) => c.split(':')[1]))]
  const dtags = [...new Set(coords.map((c) => c.split(':').slice(2).join(':')))]
  const evs = await fetchEvents(relays, { kinds: [kind], authors, '#d': dtags }, 6000)

  const byCoord = new Map<string, T>()
  for (const ev of evs) {
    const d = extract(ev)
    if (!d) continue
    const prev = byCoord.get(d.aTag)
    if (!prev || d.createdAt > prev.createdAt) byCoord.set(d.aTag, d)
  }
  return coords.map((c) => byCoord.get(c)).filter((d): d is T => !!d)
}

function useCuratedList<T extends { aTag: string; createdAt: number }>(
  dTag: string,
  kind: number,
  extract: (ev: NostrEvent) => T | null,
): T[] {
  const [items, setItems] = useState<T[]>([])
  useEffect(() => {
    let cancelled = false
    resolveCuratedList(dTag, kind, extract)
      .then((list) => { if (!cancelled) setItems(list) })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dTag, kind])
  return items
}

/** Admin-curated "Featured Mod Requests" rail. Hidden until it has content. */
export function FeaturedRequests() {
  const items = useCuratedList<BountyDetails>(FEATURED_REQUESTS_DTAG, KINDS.BOUNTY, extractBounty)
  if (items.length === 0) return null
  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Featured Mod Requests</h2>
        <Link to="/mod-requests" className="text-orange-400 hover:text-orange-300 text-sm font-medium flex items-center gap-1">
          View All <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.slice(0, 4).map((b) => <BountyCard key={b.aTag} bounty={b} />)}
      </div>
    </section>
  )
}

/** Admin-curated "Featured Mod Jams" rail. Hidden until it has content. */
export function FeaturedJams() {
  const items = useCuratedList<JamDetails>(FEATURED_JAMS_DTAG, KINDS.JAM, extractJam)
  if (items.length === 0) return null
  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Featured Mod Jams</h2>
        <Link to="/mod-jams" className="text-[#fc4462] hover:text-[#fc4462]/80 text-sm font-medium flex items-center gap-1">
          View All <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.slice(0, 4).map((j) => <JamCard key={j.aTag} jam={j} />)}
      </div>
    </section>
  )
}
