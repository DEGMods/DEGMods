import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { extractAds, ADS_DTAG, type AdEntry } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { AdCard } from '@/pages/AdsPage'

const AD_SEEN_KEY = 'deg-mods-ad-seen'

/**
 * Round-robin ad picker (mirrors DEN Chat's login showcase): pick a random ad
 * the visitor hasn't seen yet this cycle, tracking seen banners in localStorage.
 * Prunes banners no longer in the list (handles admin edits) and resets the
 * cycle once every ad has been shown — so the same ad isn't repeated until the
 * whole rotation is exhausted.
 */
function pickUnseenAd(list: AdEntry[]): AdEntry {
  const allUrls = new Set(list.map((e) => e.banner))
  let seen: Set<string>
  try {
    const raw = localStorage.getItem(AD_SEEN_KEY)
    const arr: string[] = raw ? JSON.parse(raw) : []
    seen = new Set(arr.filter((u) => allUrls.has(u)))
  } catch {
    seen = new Set<string>()
  }

  let unseen = list.filter((e) => !seen.has(e.banner))
  if (unseen.length === 0) {
    seen.clear()
    unseen = list
  }

  const pick = unseen[Math.floor(Math.random() * unseen.length)]
  seen.add(pick.banner)
  try { localStorage.setItem(AD_SEEN_KEY, JSON.stringify([...seen])) } catch { /* ignore */ }
  return pick
}

/** A single rotating sponsored ad, shown in the mod/blog page sidebar. Reuses the
 *  shared <AdCard> so it stays consistent with the /ads page and home Ads section. */
export function SidebarAd() {
  const [ad, setAd] = useState<AdEntry | null>(null)

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    // Multi-pass so a fast relay serving a stale ads revision can't win over the
    // relay holding the newest one.
    fetchLatestEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [ADS_DTAG] })
      .then((ev) => {
        if (cancelled || !ev) return
        const ads = extractAds(ev).filter((a) => a.banner)
        if (ads.length > 0) setAd(pickUnseenAd(ads))
      })
      .catch(() => { /* no ads */ })
    return () => { cancelled = true }
  }, [])

  if (!ad) return null

  return (
    <div className="border-t border-[#262626] pt-6">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Handpicked Ad</p>
        <Link to="/ads" className="text-[11px] font-medium text-purple-400 hover:text-purple-300">View all ads</Link>
      </div>
      <AdCard ad={ad} />
    </div>
  )
}
