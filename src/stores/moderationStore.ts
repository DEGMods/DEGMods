/**
 * Moderation store: admin-curated defaults and blocklists.
 *
 * - Default "excluded tags" (NIP-78, d: moderation-excluded-tags)
 * - Blocked mods (NIP-78, d: blocked-mods) — hidden from discovery, optionally
 *   render-blocked when marked.
 * - Blocked users (NIP-51 mute list, kind 10000) — their content is hidden.
 *
 * The admin manages all of these from the Moderation tab; everyone else reads
 * them so site moderation can change without a code deploy. Persisted so the
 * last-known lists are available instantly on the next visit.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Event as NostrEvent } from 'nostr-tools'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { useModFiltersStore } from '@/stores/modFiltersStore'
import {
  KINDS, ADMIN_PUBKEY, MODERATION_EXCLUDED_TAGS_DTAG, BLOCKED_MODS_DTAG,
  DEFAULT_EXCLUDED_TAGS,
} from '@/lib/constants'

export interface BlockedMod {
  /** Mod coordinate, e.g. 31142:<pubkey>:<dtag>. */
  coord: string
  /** When true, the mod is render-blocked even on direct open (hard moderation). */
  viewBlocked: boolean
}

interface ModerationState {
  excludedTags: string[]
  blockedMods: BlockedMod[]
  blockedUsers: string[]
  lastUpdated: number
  syncing: boolean
  syncModeration: (relayUrls: string[]) => Promise<void>
}

function parseBlockedMods(event: NostrEvent | null): BlockedMod[] {
  if (!event) return []
  return event.tags
    .filter((t) => t[0] === 'a' && t[1])
    .map((t) => ({ coord: t[1], viewBlocked: t[2] === 'block' }))
}

export const useModerationStore = create<ModerationState>()(
  persist(
    (set) => ({
      excludedTags: DEFAULT_EXCLUDED_TAGS,
      blockedMods: [],
      blockedUsers: [],
      lastUpdated: 0,
      syncing: false,

      syncModeration: async (relayUrls) => {
        if (relayUrls.length === 0) return
        set({ syncing: true })
        try {
          const [tagsEvent, blockedEvent, muteEvent] = await Promise.all([
            fetchEvent(relayUrls, {
              kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [MODERATION_EXCLUDED_TAGS_DTAG],
            }),
            fetchEvent(relayUrls, {
              kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [BLOCKED_MODS_DTAG],
            }),
            fetchEvent(relayUrls, { kinds: [KINDS.MUTE_LIST], authors: [ADMIN_PUBKEY] }),
          ])

          const next: Partial<ModerationState> = { lastUpdated: Date.now() }

          if (tagsEvent) {
            const tags = tagsEvent.tags
              .filter((t) => t[0] === 't' && t[1])
              .map((t) => t[1].toLowerCase())
            next.excludedTags = tags
            useModFiltersStore.getState().applyExcludedTagsDefaults(tags)
          }
          if (blockedEvent) next.blockedMods = parseBlockedMods(blockedEvent)
          if (muteEvent) {
            next.blockedUsers = muteEvent.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1])
          }

          set(next)
        } catch {
          // keep the last-known lists
        } finally {
          set({ syncing: false })
        }
      },
    }),
    { name: 'deg-mods:moderation' },
  ),
)
