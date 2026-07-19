import { useEffect } from 'react'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { useSettingsStore } from '@/stores/settingsStore'
import { useDnnStore } from '@/stores/dnnStore'
import { shareableShortAddress, shortCodeOf } from '@/lib/nostr/nipShort'

/**
 * Swap a post's naddr URL for its NIP-SHORT address once one is known.
 *
 * Purely cosmetic and best-effort: the page has already loaded from the naddr,
 * and this only rewrites the address bar so what the reader copies is the short
 * form. Uses replaceState rather than navigation — pushing would put a
 * meaningless extra entry in the back stack for a URL change the reader never
 * asked for.
 *
 * A verified DNN ID is preferred over the npub because it's dramatically
 * shorter (`snAbandonAbility2DH1f4c2a` vs the 63-character npub form), which is
 * the entire point of the short address.
 *
 * Silent on every failure. A missing `s` tag, an unreachable relay during the
 * collision check, or no DNN ID all just leave the naddr in place.
 */
export function useShortUrl(event: NostrEvent | null | undefined) {
  // The DNN id may arrive after the profile verifies, so re-run when it lands.
  const dnnId = useDnnStore((s) => (event ? s.getVerifiedDnnId(event.pubkey) : null))

  useEffect(() => {
    if (!event || !shortCodeOf(event)) return
    let cancelled = false

    ;(async () => {
      try {
        const authority = dnnId || nip19.npubEncode(event.pubkey)
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const address = await shareableShortAddress(relays, event, authority)
        if (cancelled || !address) return
        const next = `/s/${address}`
        if (window.location.pathname !== next) {
          window.history.replaceState(null, '', next + window.location.search)
        }
      } catch {
        // Best-effort: the naddr URL already works.
      }
    })()

    return () => { cancelled = true }
  }, [event, dnnId])
}
