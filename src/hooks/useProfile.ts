import { useState, useEffect } from 'react'
import { nip19 } from 'nostr-tools'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { useSettingsStore } from '@/stores/settingsStore'

/** Fetch + cache a user's profile by pubkey; returns the profile plus a display name and npub. */
export function useProfile(pubkey: string | null | undefined) {
  const [profile, setProfile] = useState<UserProfile | null>(() =>
    pubkey ? useUserStore.getState().getCachedProfile(pubkey) : null,
  )

  useEffect(() => {
    if (!pubkey) { setProfile(null); return }
    const cached = useUserStore.getState().getCachedProfile(pubkey)
    if (cached) { setProfile(cached); return }
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(pubkey, relays).then((p) => { if (!cancelled) setProfile(p) })
    return () => { cancelled = true }
  }, [pubkey])

  const npub = pubkey ? nip19.npubEncode(pubkey) : ''
  const name = profile?.display_name || profile?.name || (npub ? `${npub.slice(0, 10)}…` : 'Unknown')
  return { profile, name, npub }
}
