/**
 * Notification unread-state — drives the nav bell dot.
 *
 * Read-state uses the same convention as Den Chat / Jumble: a NIP-78 (kind
 * 30078) replaceable event under d-tag `notifications_seen_at`, whose
 * `created_at` IS the "last seen" timestamp (content is informational). This
 * makes the seen-state sync across any client that follows the convention.
 *
 * `hasUnread` = the newest notification's created_at > last-seen. localStorage
 * caches last-seen for instant reads; publishing the marker is throttled to
 * once per 60s.
 */
import { create } from 'zustand'
import type { Event as NostrEvent } from 'nostr-tools'
import { fetchEvent, fetchEvents, publishEvent } from '@/lib/nostr/relay-pool'
import { signEvent } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { KINDS } from '@/lib/constants'

const APP_DATA_KIND = 30078
const SEEN_DTAG = 'notifications_seen_at' // Jumble/Den Chat-compatible
const CACHE_KEY = 'degmods:notifications-seen-at'
const PUBLISH_THROTTLE_S = 60
const REFRESH_TTL_MS = 3 * 60 * 1000

function cachedSeen(): number {
  const n = Number(localStorage.getItem(CACHE_KEY))
  return Number.isFinite(n) ? n : 0
}

// Newest created_at across everything that would appear in NotificationsView
// (social interactions on the user's pubkey + comments/reactions/zaps on the
// user's mods & blogs). Only the max timestamp is needed for the badge.
async function fetchNewestNotifTs(pubkey: string): Promise<number> {
  const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
  let newest = 0
  const bump = (evs: NostrEvent[], isSelf: (e: NostrEvent) => boolean) => {
    for (const e of evs) if (!isSelf(e) && e.created_at > newest) newest = e.created_at
  }
  try {
    // Social: mentions/replies/reactions/reposts/zaps referencing my pubkey.
    const social = await fetchEvents(relays, { kinds: [1, 7, 6, 9735], '#p': [pubkey], limit: 30 }, 6000)
    bump(social, (e) => e.pubkey === pubkey)

    // My mods/blogs → their addressable coordinates.
    const mine = await fetchEvents(relays, { kinds: [KINDS.MOD, KINDS.BLOG], authors: [pubkey], limit: 200 }, 6000)
    const aTags = mine.map((e) => `${e.kind}:${pubkey}:${e.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`)
    if (aTags.length) {
      const [comments, reactions, zaps] = await Promise.all([
        fetchEvents(relays, { kinds: [1111], '#A': aTags, limit: 30 }, 6000),
        fetchEvents(relays, { kinds: [7], '#a': aTags, limit: 30 }, 6000),
        fetchEvents(relays, { kinds: [9735], '#a': aTags, limit: 20 }, 6000),
      ])
      bump(comments, (e) => e.pubkey === pubkey)
      bump(reactions, (e) => e.pubkey === pubkey)
      bump(zaps, () => false)
    }
  } catch {
    // best-effort — a failed refresh just leaves the prior state
  }
  return newest
}

let lastRefresh = 0
let lastPublished = 0

interface NotificationsState {
  newestTs: number
  lastSeen: number
  /** Fetch newest-notification + last-seen timestamps (throttled by a TTL). */
  refresh: (pubkey: string, force?: boolean) => Promise<void>
  /** Mark everything seen now — clears the dot; publishes the 30078 marker (throttled). */
  markSeen: (pubkey: string) => Promise<void>
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  newestTs: 0,
  lastSeen: cachedSeen(),

  refresh: async (pubkey, force = false) => {
    const now = Date.now()
    if (!force && now - lastRefresh < REFRESH_TTL_MS && get().newestTs) return
    lastRefresh = now
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    const [newest, seenEv] = await Promise.all([
      fetchNewestNotifTs(pubkey),
      fetchEvent(relays, { kinds: [APP_DATA_KIND], authors: [pubkey], '#d': [SEEN_DTAG] }).catch(() => null),
    ])
    const lastSeen = Math.max(cachedSeen(), seenEv?.created_at ?? 0)
    if (lastSeen) localStorage.setItem(CACHE_KEY, String(lastSeen))
    set({ newestTs: newest, lastSeen })
  },

  markSeen: async (pubkey) => {
    const now = Math.floor(Date.now() / 1000)
    localStorage.setItem(CACHE_KEY, String(now))
    set({ lastSeen: now })
    if (now - lastPublished < PUBLISH_THROTTLE_S) return
    lastPublished = now
    try {
      const signed = await signEvent({
        kind: APP_DATA_KIND,
        content: 'Records read time to sync notification status across devices.',
        tags: [['d', SEEN_DTAG]],
        created_at: now,
        pubkey,
      })
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('write')
      await publishEvent(signed as unknown as NostrEvent, relays)
    } catch {
      // non-fatal — the local cache already reflects "seen"
    }
  },
}))
