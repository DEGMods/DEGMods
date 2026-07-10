/**
 * Follows store: the current user's NIP-02 contact list (kind 3).
 *
 * Fetched once and cached. Follow/unfollow only touch the specific `p` entry,
 * never rewriting the rest of the list. If the list can't be loaded (network
 * failure, or the user has none yet), callers are expected to warn before
 * creating a fresh list so an existing one isn't clobbered.
 */

import { create } from 'zustand'
import type { Event as NostrEvent } from 'nostr-tools'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { signAndPublish } from '@/lib/nostr/publish'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { KINDS } from '@/lib/constants'

interface FollowsState {
  owner: string | null
  contactEvent: NostrEvent | null
  /** True once a contact list was successfully fetched for the current owner. */
  loaded: boolean
  loading: boolean

  /** Fetch the current user's contact list. Returns whether a list was found. */
  loadContacts: (force?: boolean) => Promise<boolean>
  isFollowing: (pubkey: string) => boolean
  /** Add/remove a single `p` entry and publish. `fromScratch` starts a new empty list. */
  setFollow: (pubkey: string, follow: boolean, fromScratch?: boolean) => Promise<{ success: boolean; error?: string }>
  reset: () => void
}

export const useFollowsStore = create<FollowsState>((set, get) => ({
  owner: null,
  contactEvent: null,
  loaded: false,
  loading: false,

  loadContacts: async (force) => {
    const myPubkey = useAuthStore.getState().pubkey
    if (!myPubkey) return false
    // Different account than what's cached, drop stale data.
    if (get().owner !== myPubkey) set({ contactEvent: null, loaded: false })
    if (get().owner === myPubkey && get().loaded && !force) return true

    set({ loading: true, owner: myPubkey })
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, { kinds: [KINDS.CONTACTS], authors: [myPubkey] })
      set({ contactEvent: event, loaded: !!event, loading: false })
      return !!event
    } catch {
      set({ loading: false, loaded: false })
      return false
    }
  },

  isFollowing: (pubkey) => {
    const e = get().contactEvent
    return !!e?.tags.some(t => t[0] === 'p' && t[1] === pubkey)
  },

  setFollow: async (pubkey, follow, fromScratch = false) => {
    const base = fromScratch ? [] : (get().contactEvent?.tags ?? [])
    const withoutThis = base.filter(t => !(t[0] === 'p' && t[1] === pubkey))
    const tags: string[][] = follow ? [...withoutThis, ['p', pubkey]] : withoutThis
    const content = fromScratch ? '' : (get().contactEvent?.content ?? '')

    const res = await signAndPublish({
      kind: KINDS.CONTACTS,
      content,
      tags,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: '',
    })
    if (res.success && res.event) set({ contactEvent: res.event, loaded: true })
    return { success: res.success, error: res.error }
  },

  reset: () => set({ owner: null, contactEvent: null, loaded: false, loading: false }),
}))
