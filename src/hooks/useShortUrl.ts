import { useEffect } from 'react'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { useSettingsStore } from '@/stores/settingsStore'
import { useDnnStore } from '@/stores/dnnStore'
import { shareableShortAddress, shortCodeOf, verifiedShortAddress } from '@/lib/nostr/nipShort'
import { reportCanonicalPath } from '@/hooks/useAnalytics'

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
export function useShortUrl(event: NostrEvent | null | undefined, basePath: string) {
  // The DNN id may arrive after the profile verifies, so re-run when it lands.
  const dnnId = useDnnStore((s) => (event ? s.getVerifiedDnnId(event.pubkey) : null))

  // Tell analytics which address identifies this post, before anything below
  // rewrites the bar to a short one. Derived from the event, so no network — and
  // it runs even when there's no short code, since the page still needs to
  // report *something* for the view to be sent.
  useEffect(() => {
    if (!event) return
    const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    try {
      const naddr = nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: d })
      reportCanonicalPath(`${basePath}/${naddr}`)
    } catch { /* not addressable — the fallback path is recorded instead */ }
  }, [event, basePath])

  useEffect(() => {
    if (!event || !shortCodeOf(event)) return
    let cancelled = false

    const authority = dnnId || nip19.npubEncode(event.pubkey)
    // Stays on the page's own path — /mod/<short>, not a separate resolver route
    // — so the URL keeps saying what it points at and a reload lands here.
    const set = (address: string) => {
      const next = `${basePath}/${address}`
      if (window.location.pathname !== next) {
        window.history.replaceState(null, '', next + window.location.search)
      }
    }

    // Verifying the code needs no network, so switch immediately rather than
    // holding a 100-character naddr in the bar while a relay confirms the code
    // is unique. The rare collision appends its selector when the check returns.
    const optimistic = verifiedShortAddress(event, authority)
    if (optimistic) set(optimistic)

    ;(async () => {
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const address = await shareableShortAddress(relays, event, authority)
        if (!cancelled && address && address !== optimistic) set(address)
      } catch {
        // Best-effort: whatever is in the bar already works.
      }
    })()

    return () => { cancelled = true }
  }, [event, dnnId, basePath])
}
