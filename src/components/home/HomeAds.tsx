import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { extractAds, ADS_DTAG, type AdEntry } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { AdCard } from '@/pages/AdsPage'

/** Home-page ads section — up to 4 live ads, "View All" → /ads. Hidden if none. */
export function HomeAds() {
  const [ads, setAds] = useState<AdEntry[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const ev = await fetchLatestEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [ADS_DTAG] })
        if (!cancelled) setAds(ev ? extractAds(ev) : [])
      } catch {
        if (!cancelled) setAds([])
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (ads.length === 0) return null

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Ads</h2>
        <Link to="/ads" className="text-purple-400 hover:text-purple-300 text-sm font-medium flex items-center gap-1">
          View All <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {ads.slice(0, 4).map((ad, i) => <AdCard key={i} ad={ad} />)}
      </div>
    </section>
  )
}
