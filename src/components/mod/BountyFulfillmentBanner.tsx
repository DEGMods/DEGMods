import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { PackagePlus, Trophy, Gift } from 'lucide-react'
import { KINDS } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { extractBounty, bountyNaddrFromCoordinate, type BountyDetails } from '@/lib/nostr/bounty'

/**
 * Shown on a mod that fulfils a bounty: the bounty it's for, with a trophy when
 * this mod is the chosen fulfiller. Mirrors the mod-jam banner.
 */
export function BountyFulfillmentBanner({ bountyCoordinate, modCoordinate }: { bountyCoordinate: string; modCoordinate: string }) {
  const [bounty, setBounty] = useState<BountyDetails | null>(null)

  useEffect(() => {
    let cancelled = false
    const parts = bountyCoordinate.split(':')
    if (parts.length < 3 || Number(parts[0]) !== KINDS.BOUNTY) return
    const pubkey = parts[1]
    const identifier = parts.slice(2).join(':')
    ;(async () => {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const ev = await fetchLatestEvent(relays, { kinds: [KINDS.BOUNTY], authors: [pubkey], '#d': [identifier] })
      if (!cancelled) setBounty(ev ? extractBounty(ev) : null)
    })()
    return () => { cancelled = true }
  }, [bountyCoordinate])

  if (!bounty) return null
  const naddr = bountyNaddrFromCoordinate(bountyCoordinate)
  if (!naddr) return null
  const isWinner = bounty.winnerCoordinate === modCoordinate

  return (
    <Link
      to={`/mod-bounty/${naddr}`}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm transition-colors hover:border-purple-500/50"
    >
      <span className="inline-flex items-center gap-1.5 font-medium text-purple-300"><PackagePlus className="h-4 w-4" /> Fulfils a mod request</span>
      <span className="font-semibold text-white">{bounty.title}</span>
      <span className="text-neutral-400">· {bounty.game}</span>
      {isWinner && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300"><Trophy className="h-3 w-3" /> Chosen fulfiller</span>}
      {bounty.reward && <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><Gift className="h-3 w-3" /> {bounty.reward.what}</span>}
    </Link>
  )
}
