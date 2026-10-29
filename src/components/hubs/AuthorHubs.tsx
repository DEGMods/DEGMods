import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { parseHubRecommendations, HUB_RECOMMENDATIONS_DTAG, type HubRec } from '@/lib/nostr/hubs'
import { HubCard } from '@/components/hubs/HubCard'

const NIP78_KIND = 30078

/**
 * A creator's own recommended community hub.
 *
 * Reads THIS author's recommended-hubs list (same NIP-78 d-tag as the site's, but
 * authored by the creator rather than the site admin) and shows their first
 * (priority) hub. When they haven't recommended any, it says so — an explicit
 * empty state rather than a blank gap, like the per-author blog-posts section.
 */
export function AuthorHubs({ pubkey }: { pubkey: string }) {
  const [recs, setRecs] = useState<HubRec[] | null>(null) // null = still loading

  useEffect(() => {
    let cancelled = false
    setRecs(null)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchEvent(relays, { kinds: [NIP78_KIND], authors: [pubkey], '#d': [HUB_RECOMMENDATIONS_DTAG] })
      .then((ev) => { if (!cancelled) setRecs(parseHubRecommendations(ev)) })
      .catch(() => { if (!cancelled) setRecs([]) })
    return () => { cancelled = true }
  }, [pubkey])

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-200">
        <img src="/denchat-logo.svg" alt="" className="h-5 w-5" />
        Community hub
      </h2>
      {recs === null ? (
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : recs.length === 0 ? (
        <p className="text-sm text-neutral-500">This creator hasn’t recommended a community hub yet.</p>
      ) : (
        <HubCard rec={recs[0]} />
      )}
    </section>
  )
}
