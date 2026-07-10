import { useState, useEffect } from 'react'
import { User, ExternalLink } from 'lucide-react'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { extractAds, ADS_DTAG, type AdEntry } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { BlossomImage } from '@/components/shared/BlossomImage'

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

/** A single rotating sponsored ad, shown in the mod page sidebar. */
export function SidebarAd() {
  const [ad, setAd] = useState<AdEntry | null>(null)

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [ADS_DTAG] })
      .then((ev) => {
        if (cancelled || !ev) return
        const ads = extractAds(ev).filter((a) => a.banner)
        if (ads.length > 0) setAd(pickUnseenAd(ads))
      })
      .catch(() => { /* no ads */ })
    return () => { cancelled = true }
  }, [])

  if (!ad) return null

  const buttons = ad.buttons.filter((b) => b.text.trim() && b.link.trim())

  return (
    <div className="border-t border-[#262626] pt-6">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Handpicked Ad</p>
      <div className="overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c]">
        <div className="relative aspect-[16/7] w-full bg-gradient-to-br from-purple-900/40 to-[#212121]">
          <BlossomImage src={ad.banner} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="p-3">
          <div className="flex items-center gap-2.5">
            {ad.profilePic ? (
              <BlossomImage src={ad.profilePic} alt="" className="h-8 w-8 shrink-0 rounded-full border border-[#262626] object-cover" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#212121] text-neutral-500">
                <User className="h-4 w-4" />
              </div>
            )}
            {ad.name && <p className="min-w-0 truncate text-sm font-semibold text-white">{ad.name}</p>}
          </div>
          {ad.description && <p className="mt-2 whitespace-pre-wrap text-xs text-neutral-300">{ad.description}</p>}
          {buttons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {buttons.map((b, i) => (
                <a
                  key={i}
                  href={b.link.startsWith('http') ? b.link : `https://${b.link}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-700"
                >
                  {b.text}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
