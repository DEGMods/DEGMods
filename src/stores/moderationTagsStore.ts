/**
 * Moderation tag overlays (kind 30985) — admin tags applied to others' posts.
 *
 * Deliberately *not* a fetch-everything store like `moderationStore`. The set of
 * tagged posts grows with the catalogue, so this fetches only what's on screen:
 * cards ask for their own coordinate, requests are batched into one query per
 * tick, and results are cached — including **negative** results.
 *
 * Caching the negatives is what makes it cheap. Without a "checked, clean"
 * marker there's no way to tell an unflagged post from an unchecked one, so
 * every render would re-query and re-gate forever.
 *
 * Failures resolve *open*: a relay that times out marks the post checked for
 * this session so it renders normally, but is not written to the persisted
 * cache, so the next visit tries again. The trade is deliberate — a relay
 * hiccup shows an admin-corrected post untagged rather than freezing the grid.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { KINDS, ADMIN_PUBKEY } from '@/lib/constants'
import {
  MODERATION_NAMESPACE, latestPerTarget, type ModerationOverlay,
} from '@/lib/nostr/moderationTags'

/** Coordinates per relay query. 200 makes a ~20KB filter that relays may reject. */
const BATCH_SIZE = 40
/** How long to gather requests from separate cards before firing one query. */
const COALESCE_MS = 60
const QUERY_TIMEOUT_MS = 6000

/**
 * Longest the reveal gate will hold an image waiting for an answer.
 *
 * The gate was designed on the assumption that this query beats the image
 * download. Measured on a cold load it doesn't come close — it queues behind the
 * listing, profile and legacy fetches in the relay pool's read throttle, and
 * images sat blurred for ~9s. So the wait is capped: past this point the post is
 * treated as checked and renders, and if the real answer arrives later it is
 * still applied. Same fail-open rule as a timeout, just reached sooner.
 */
const GATE_MS = 1500

interface ModerationTagsState {
  /** Persisted results. `null` means checked and carrying no tags. */
  overlays: Record<string, ModerationOverlay | null>
  /** Resolved this session, including fail-open. Not persisted. */
  resolved: Record<string, true>
  /** Ask for these targets; safe to call on every render. */
  ensure: (keys: string[]) => void
  /** Has this target been settled, either way? Drives the reveal gate. */
  isChecked: (key: string) => boolean
  /** Everything the admin has tagged — admin view only, so a full fetch is fine. */
  fetchAll: () => Promise<Map<string, ModerationOverlay>>
  /** Drop a target's cached state so the next render re-checks it. */
  invalidate: (key: string) => void
}

/** Requested but not yet queried, and queries already in the air. */
const pending = new Set<string>()
const inFlight = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

export const useModerationTagsStore = create<ModerationTagsState>()(
  persist(
    (set, get) => {
      const flush = async () => {
        flushTimer = null
        const keys = [...pending]
        pending.clear()
        if (keys.length === 0) return
        keys.forEach((k) => inFlight.add(k))

        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        if (relays.length === 0) {
          // Nothing to ask — resolve open so cards don't hang.
          set((s) => ({ resolved: { ...s.resolved, ...Object.fromEntries(keys.map((k) => [k, true as const])) } }))
          keys.forEach((k) => inFlight.delete(k))
          return
        }

        for (let i = 0; i < keys.length; i += BATCH_SIZE) {
          const chunk = keys.slice(i, i + BATCH_SIZE)
          try {
            const events = await fetchEvents(relays, {
              kinds: [KINDS.MODERATION_TAG],
              authors: [ADMIN_PUBKEY],
              '#d': chunk,
            }, QUERY_TIMEOUT_MS)
            const found = latestPerTarget(events)
            set((s) => {
              const overlays = { ...s.overlays }
              const resolved = { ...s.resolved }
              for (const key of chunk) {
                // Absent from the response ⇒ checked and clean. That negative is
                // the whole point: it stops this post being re-queried forever.
                overlays[key] = found.get(key) ?? null
                resolved[key] = true
              }
              return { overlays, resolved }
            })
          } catch {
            // Fail open, and don't poison the persisted cache with a guess.
            set((s) => ({
              resolved: { ...s.resolved, ...Object.fromEntries(chunk.map((k) => [k, true as const])) },
            }))
          } finally {
            chunk.forEach((k) => inFlight.delete(k))
          }
        }
      }

      return {
        overlays: {},
        resolved: {},

        ensure: (keys) => {
          const { overlays, resolved } = get()
          let added = false
          for (const key of keys) {
            if (!key) continue
            if (key in overlays || resolved[key] || pending.has(key) || inFlight.has(key)) continue
            pending.add(key)
            added = true
            // Open the gate if the answer is taking too long. The query keeps
            // running; this only stops the image being held hostage to it.
            setTimeout(() => {
              const s = get()
              if (key in s.overlays || s.resolved[key]) return
              set((st) => ({ resolved: { ...st.resolved, [key]: true } }))
            }, GATE_MS)
          }
          // Coalesce: twenty cards mounting together produce one query, not twenty.
          if (added && !flushTimer) flushTimer = setTimeout(flush, COALESCE_MS)
        },

        isChecked: (key) => {
          const { overlays, resolved } = get()
          return key in overlays || !!resolved[key]
        },

        fetchAll: async () => {
          const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
          const events = await fetchEvents(relays, {
            kinds: [KINDS.MODERATION_TAG],
            authors: [ADMIN_PUBKEY],
            '#L': [MODERATION_NAMESPACE],
          }, 10000)
          const map = latestPerTarget(events)
          // Fold into the cache so the admin's own listing warms the render path.
          set((s) => {
            const overlays = { ...s.overlays }
            const resolved = { ...s.resolved }
            for (const [key, overlay] of map) {
              overlays[key] = overlay
              resolved[key] = true
            }
            return { overlays, resolved }
          })
          return map
        },

        invalidate: (key) => set((s) => {
          const overlays = { ...s.overlays }
          const resolved = { ...s.resolved }
          delete overlays[key]
          delete resolved[key]
          return { overlays, resolved }
        }),
      }
    },
    {
      name: 'deg-mods:moderation-tags',
      // Only real results survive a reload; fail-open marks must not.
      partialize: (s) => ({ overlays: s.overlays }),
    },
  ),
)
