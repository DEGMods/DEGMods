import { useState, useEffect } from 'react'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { extractEmulatedPlatforms, EMULATED_PLATFORMS_DTAG } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { SuggestInput } from '@/components/shared/SuggestInput'

/**
 * Platform input with admin-published suggestions (NIP-78). Users can pick a
 * suggestion or type their own — uses the app's shared suggestion dropdown.
 */
export function EmulatedPlatformField({ value, onChange, className, maxLength = 50 }: {
  value: string
  onChange: (v: string) => void
  className?: string
  maxLength?: number
}) {
  const [platforms, setPlatforms] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const ev = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [EMULATED_PLATFORMS_DTAG] })
        if (!cancelled && ev) setPlatforms(extractEmulatedPlatforms(ev))
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <SuggestInput
      value={value}
      onChange={onChange}
      items={platforms}
      minChars={0}
      placeholder="platform (eg: Playstation 4, Xbox 360)"
      maxLength={maxLength}
      className={className}
    />
  )
}
