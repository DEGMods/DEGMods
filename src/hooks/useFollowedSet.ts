import { useEffect, useMemo } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useFollowsStore } from '@/stores/followsStore'

/**
 * Pubkeys exempt from the PoW content filter: people you follow + yourself.
 * Ensures the contact list is loaded so the exemption works app-wide.
 */
export function useFollowedSet(): Set<string> {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const contactEvent = useFollowsStore((s) => s.contactEvent)
  const loaded = useFollowsStore((s) => s.loaded)
  const loadContacts = useFollowsStore((s) => s.loadContacts)

  useEffect(() => {
    if (myPubkey && !loaded) loadContacts()
  }, [myPubkey, loaded, loadContacts])

  return useMemo(() => {
    const set = new Set<string>()
    if (contactEvent) for (const t of contactEvent.tags) if (t[0] === 'p' && t[1]) set.add(t[1])
    if (myPubkey) set.add(myPubkey)
    return set
  }, [contactEvent, myPubkey])
}
