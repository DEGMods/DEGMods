import { Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { type FeaturedBanner as Banner } from '@/lib/nostr/events'

function coordToNaddr(coord: string): string | null {
  const [kindStr, pubkey, ...rest] = coord.split(':')
  if (!kindStr || !pubkey) return null
  try {
    return nip19.naddrEncode({ kind: Number(kindStr), pubkey, identifier: rest.join(':') })
  } catch {
    return null
  }
}

// Fade both side edges into the (image-coloured) side background.
const EDGE_MASK = 'linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%)'

/**
 * Admin-curated full-width banner above the slider, linking to one mod. Renders
 * nothing unless the `banner` (from the NIP-78 `featured-mod-banner` event, fed
 * by HomePage's cached + background-refreshed data) has an image and a valid
 * mod coordinate.
 *
 * The side margins carry a blurred copy of the same image stretched across the
 * full width, so the left margin continues the banner's left-edge colours and
 * the right margin its right-edge colours. This needs no canvas pixel reads, so
 * it works even for image hosts that don't send CORS headers.
 */
export function FeaturedBanner({ banner }: { banner: Banner | null }) {
  if (!banner) return null
  const naddr = coordToNaddr(banner.coord)
  if (!naddr) return null

  return (
    <div className="relative w-screen mx-[calc(50%_-_50vw)] overflow-hidden">
      {/* Blurred, full-width backdrop: left of centre shows the banner's
          left-edge colours, right of centre its right-edge colours. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 scale-110"
        style={{
          backgroundImage: `url(${banner.image})`,
          backgroundSize: '100% 100%',
          filter: 'blur(48px) saturate(1.2) brightness(0.85)',
        }}
      />
      <div className="relative mx-auto max-w-[90rem] px-4">
        <Link to={`/mod/${naddr}`} className="block" aria-label="Featured mod">
          <img
            src={banner.image}
            alt=""
            className="h-auto max-h-[450px] w-full object-cover"
            style={{ maskImage: EDGE_MASK, WebkitMaskImage: EDGE_MASK }}
            onError={(e) => { (e.currentTarget.closest('.relative')?.parentElement as HTMLElement | null)?.style.setProperty('display', 'none') }}
          />
        </Link>
      </div>
    </div>
  )
}
