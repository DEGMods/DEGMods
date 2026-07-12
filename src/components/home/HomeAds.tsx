import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { type AdEntry } from '@/lib/nostr/events'
import { AdCard } from '@/pages/AdsPage'

/**
 * Home-page ads section — up to 4 live ads, "View All" → /ads. Always shown.
 * Ads come from HomePage's cached + background-refreshed data (NIP-78 site-ads),
 * so they paint instantly on return and update behind the refresh indicator.
 */
export function HomeAds({ ads, loading }: { ads: AdEntry[]; loading: boolean }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Ads</h2>
        <Link to="/ads" className="text-purple-400 hover:text-purple-300 text-sm font-medium flex items-center gap-1">
          View All <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      {ads.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ads.slice(0, 4).map((ad, i) => <AdCard key={i} ad={ad} />)}
        </div>
      ) : (
        <p className="text-neutral-500 text-center py-8">
          {loading ? 'Loading…' : 'No ads found.'}
        </p>
      )}
    </section>
  )
}
