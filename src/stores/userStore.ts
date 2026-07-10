/**
 * User Store: user profiles and metadata
 */

import { create } from 'zustand'
import { LRUCache } from 'lru-cache'
import type { Event as NostrEvent } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { KINDS } from '@/lib/constants'
import type { ProfileMetadata } from '@/lib/nostr/events'

export interface UserProfile extends ProfileMetadata {
  pubkey: string
  npub: string
  created_at: number
}

const profileCache = new LRUCache<string, UserProfile>({ max: 500, ttl: 5 * 60 * 1000 })

export interface UserState {
  currentProfile: UserProfile | null

  setCurrentProfile: (profile: UserProfile | null) => void
  fetchProfile: (pubkey: string, relayUrls: string[]) => Promise<UserProfile | null>
  getCachedProfile: (pubkey: string) => UserProfile | null
  clearProfileCache: () => void
}

export const useUserStore = create<UserState>((set) => ({
  currentProfile: null,

  setCurrentProfile: (profile) => set({ currentProfile: profile }),

  fetchProfile: async (pubkey, relayUrls) => {
    const cached = profileCache.get(pubkey)
    if (cached) return cached

    const event = await fetchEvent(
      relayUrls,
      { kinds: [KINDS.METADATA], authors: [pubkey] },
      5000,
    )
    if (!event) return null

    const profile = parseProfileEvent(event)
    profileCache.set(pubkey, profile)
    return profile
  },

  getCachedProfile: (pubkey) => profileCache.get(pubkey) ?? null,
  clearProfileCache: () => profileCache.clear(),
}))

function parseProfileEvent(event: NostrEvent): UserProfile {
  let metadata: ProfileMetadata = {}
  try {
    metadata = JSON.parse(event.content)
  } catch {
    // Invalid JSON
  }
  return {
    ...metadata,
    pubkey: event.pubkey,
    npub: nip19.npubEncode(event.pubkey),
    created_at: event.created_at,
  }
}
