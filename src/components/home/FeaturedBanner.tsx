import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { extractFeaturedBanner, FEATURED_BANNER_DTAG, type FeaturedBanner as Banner } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'

function coordToNaddr(coord: string): string | null {
  const [kindStr, pubkey, ...rest] = coord.split(':')
  if (!kindStr || !pubkey) return null
  try {
    return nip19.naddrEncode({ kind: Number(kindStr), pubkey, identifier: rest.join(':') })
  } catch {
    return null
  }
}

// Fade both side edges into the page background.
const EDGE_MASK = 'linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%)'

/**
 * Admin-curated full-width banner above the slider, linking to one mod. Renders
 * nothing unless the NIP-78 `featured-mod-banner` event has both an image and a
 * mod coordinate.
 */
export function FeaturedBanner() {
  const [banner, setBanner] = useState<Banner | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const ev = await fetchLatestEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [FEATURED_BANNER_DTAG] })
        if (!cancelled) setBanner(ev ? extractFeaturedBanner(ev) : null)
      } catch {
        if (!cancelled) setBanner(null)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!banner) return null
  const naddr = coordToNaddr(banner.coord)
  if (!naddr) return null

  return (
    <div className="w-screen mx-[calc(50%_-_50vw)]">
      <div className="mx-auto max-w-[90rem] px-4">
        <Link to={`/mod/${naddr}`} className="block" aria-label="Featured mod">
          <img
            src={banner.image}
            alt=""
            className="h-auto max-h-[450px] w-full object-cover"
            style={{ maskImage: EDGE_MASK, WebkitMaskImage: EDGE_MASK }}
            onError={(e) => { (e.currentTarget.closest('div') as HTMLElement).style.display = 'none' }}
          />
        </Link>
      </div>
    </div>
  )
}
