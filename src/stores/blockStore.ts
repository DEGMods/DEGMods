/**
 * User block store: the current user's personal NIP-51 mute list (kind 10000).
 *
 * Ported from DEN Chat. Public blocks live in plaintext `p` tags (visible to
 * relays / Web of Trust); private blocks and muted words are NIP-04 encrypted
 * to self in `content`. Tags we don't recognize are preserved so we never clobber
 * data other clients wrote. Like the follows store, if the existing list can't
 * be loaded we warn before publishing a new one (so we don't clobber it).
 */

import { create } from 'zustand'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { signAndPublish } from '@/lib/nostr/publish'
import { guardedEncrypt, guardedDecrypt } from '@/lib/auth/signerGuard'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { KINDS } from '@/lib/constants'

export type BlockType = 'public' | 'private'

interface BlockState {
  owner: string | null
  blockedPubkeys: Set<string>
  blockTypes: Map<string, BlockType>
  mutedWords: string[]
  otherTags: string[][]
  loaded: boolean
  loading: boolean

  loadBlockList: (force?: boolean) => Promise<boolean>
  isBlocked: (pubkey: string) => boolean
  getBlockType: (pubkey: string) => BlockType | undefined
  blockUser: (pubkey: string, blockType: BlockType, fromScratch?: boolean) => Promise<{ success: boolean; error?: string }>
  unblockUser: (pubkey: string) => Promise<{ success: boolean; error?: string }>
  reset: () => void
}

async function publishMuteList(get: () => BlockState): Promise<{ success: boolean; error?: string }> {
  const { pubkey: myPubkey, signer } = useAuthStore.getState()
  if (!myPubkey) return { success: false, error: 'Not logged in' }

  const { blockTypes, mutedWords, otherTags } = get()

  const publicTags: string[][] = []
  const privateTags: string[][] = []
  for (const [pk, type] of blockTypes) {
    if (type === 'public') publicTags.push(['p', pk])
    else privateTags.push(['p', pk])
  }
  for (const w of mutedWords) privateTags.push(['word', w])
  for (const t of otherTags) privateTags.push(t)

  let content = ''
  if (privateTags.length > 0) {
    try {
      content = await guardedEncrypt(JSON.stringify(privateTags), myPubkey, signer, null, 'nip04')
    } catch {
      return { success: false, error: 'Your signer could not encrypt the private block list' }
    }
  }

  const res = await signAndPublish({
    kind: KINDS.MUTE_LIST,
    content,
    tags: publicTags,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  })
  return { success: res.success, error: res.error }
}

export const useBlockStore = create<BlockState>((set, get) => ({
  owner: null,
  blockedPubkeys: new Set(),
  blockTypes: new Map(),
  mutedWords: [],
  otherTags: [],
  loaded: false,
  loading: false,

  loadBlockList: async (force) => {
    const myPubkey = useAuthStore.getState().pubkey
    if (!myPubkey) return false
    if (get().owner !== myPubkey) {
      set({ owner: myPubkey, loaded: false, blockedPubkeys: new Set(), blockTypes: new Map(), mutedWords: [], otherTags: [] })
    }
    if (get().owner === myPubkey && get().loaded && !force) return true

    set({ loading: true, owner: myPubkey })
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, { kinds: [KINDS.MUTE_LIST], authors: [myPubkey] })
      if (!event) {
        set({ loading: false, loaded: false })
        return false
      }

      const blocked = new Set<string>()
      const types = new Map<string, BlockType>()
      const words: string[] = []
      const other: string[][] = []

      for (const tag of event.tags) {
        if (tag[0] === 'p' && tag[1]) { blocked.add(tag[1]); types.set(tag[1], 'public') }
        else if (tag[0] === 'word' && tag[1]) words.push(tag[1].toLowerCase())
        else if (tag.length >= 2) other.push(tag)
      }

      if (event.content) {
        try {
          const decrypted = await guardedDecrypt(event.content, myPubkey, useAuthStore.getState().signer, null, 'nip04')
          const privateTags: string[][] = JSON.parse(decrypted)
          for (const tag of privateTags) {
            if (tag[0] === 'p' && tag[1]) { blocked.add(tag[1]); if (!types.has(tag[1])) types.set(tag[1], 'private') }
            else if (tag[0] === 'word' && tag[1]) words.push(tag[1].toLowerCase())
            else if (tag.length >= 2) other.push(tag)
          }
        } catch {
          // couldn't decrypt private portion — keep public-only view
        }
      }

      set({ blockedPubkeys: blocked, blockTypes: types, mutedWords: words, otherTags: other, loaded: true, loading: false })
      return true
    } catch {
      set({ loading: false, loaded: false })
      return false
    }
  },

  isBlocked: (pubkey) => get().blockedPubkeys.has(pubkey),
  getBlockType: (pubkey) => get().blockTypes.get(pubkey),

  blockUser: async (pubkey, blockType, fromScratch = false) => {
    const prevBlocked = get().blockedPubkeys
    const prevTypes = get().blockTypes
    if (fromScratch) {
      set({ blockedPubkeys: new Set([pubkey]), blockTypes: new Map([[pubkey, blockType]]), mutedWords: [], otherTags: [], loaded: true })
    } else {
      const blocked = new Set(prevBlocked); blocked.add(pubkey)
      const types = new Map(prevTypes); types.set(pubkey, blockType)
      set({ blockedPubkeys: blocked, blockTypes: types })
    }
    const res = await publishMuteList(get)
    if (!res.success) set({ blockedPubkeys: prevBlocked, blockTypes: prevTypes })
    return res
  },

  unblockUser: async (pubkey) => {
    const prevBlocked = get().blockedPubkeys
    const prevTypes = get().blockTypes
    const blocked = new Set(prevBlocked); blocked.delete(pubkey)
    const types = new Map(prevTypes); types.delete(pubkey)
    set({ blockedPubkeys: blocked, blockTypes: types })
    const res = await publishMuteList(get)
    if (!res.success) set({ blockedPubkeys: prevBlocked, blockTypes: prevTypes })
    return res
  },

  reset: () => set({ owner: null, blockedPubkeys: new Set(), blockTypes: new Map(), mutedWords: [], otherTags: [], loaded: false, loading: false }),
}))
