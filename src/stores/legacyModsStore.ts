/**
 * LEGACY MOD STORE — loads the historical kind-30402 "GameMod" set and exposes it
 * parsed into ModDetails. Pages merge this in client-side (legacy stores game in a
 * multi-letter tag that relays can't filter on, and kind 30402 is shared with
 * marketplaces, so we fetch the whole DEG set via the `#t=GameMod` tag and filter
 * locally). See lib/mods/legacy.ts. Remove on sunset.
 *
 * The set is bounded and frozen at the cutoff, so it's cached in IndexedDB: repeat
 * visits paint instantly from cache and only hit the relays when the cache is
 * stale (or absent). Merges cache + fresh so a transient short fetch never loses
 * mods.
 */
import { create } from 'zustand'
import type { Event as NostrEvent } from 'nostr-tools'
import type { ModDetails } from '@/types/mod'
import { fetchAllEvents } from '@/lib/nostr/relay-pool'
import { cacheEvent } from '@/lib/nostr/eventCache'
import { idbStorage } from '@/lib/storage/idbStorage'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  LEGACY_MOD_KIND, LEGACY_GAMEMOD_TAG, isLegacyModEvent, extractLegacyModData,
} from '@/lib/mods/legacy'

const PAGE = 500
const MAX_ROUNDS = 20
const CACHE_KEY = 'legacy-mods-v1'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // twice a day; the set is frozen after the cutoff

interface CacheShape { savedAt: number; events: NostrEvent[] }

// Dedupe raw events by coordinate (newest wins), enforcing GameMod + date cutoff.
function dedupeByCoord(events: NostrEvent[]): Map<string, NostrEvent> {
  const byCoord = new Map<string, NostrEvent>()
  for (const e of events) {
    if (!isLegacyModEvent(e)) continue
    const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    const key = `${e.pubkey}:${d}`
    const prev = byCoord.get(key)
    if (!prev || e.created_at > prev.created_at) byCoord.set(key, e)
  }
  return byCoord
}

// Cache raw events (so a legacy mod page renders instantly) and parse to ModDetails.
function toMods(byCoord: Map<string, NostrEvent>): ModDetails[] {
  for (const e of byCoord.values()) cacheEvent(e)
  return Array.from(byCoord.values())
    .map(extractLegacyModData)
    .filter((m) => !m.legacyMigrated) // migrated posts are represented by their new mod
    .sort((a, b) => b.publishedAt - a.publishedAt)
}

async function readCache(): Promise<CacheShape | null> {
  try {
    const raw = await idbStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheShape
    return parsed?.events?.length ? parsed : null
  } catch {
    return null
  }
}

async function writeCache(events: NostrEvent[]): Promise<void> {
  try {
    await idbStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), events } satisfies CacheShape))
  } catch {
    // serialization/quota failure is non-fatal — we just re-fetch next session.
  }
}

interface LegacyModsState {
  mods: ModDetails[]
  loaded: boolean
  loading: boolean
  load: () => Promise<void>
  /** Drop a mod from the in-memory list (e.g. right after it's migrated). */
  dropMod: (pubkey: string, dTag: string) => void
}

export const useLegacyModsStore = create<LegacyModsState>((set, get) => ({
  mods: [],
  loaded: false,
  loading: false,
  dropMod: (pubkey, dTag) =>
    set((s) => ({ mods: s.mods.filter((m) => !(m.pubkey === pubkey && m.dTag === dTag)) })),
  load: async () => {
    if (get().loaded || get().loading) return
    set({ loading: true })

    // 1) Instant paint from the IndexedDB cache, if present.
    const cached = await readCache()
    const cachedByCoord = cached ? dedupeByCoord(cached.events) : new Map<string, NostrEvent>()
    if (cachedByCoord.size > 0) {
      set({ mods: toMods(cachedByCoord), loaded: true, loading: false })
    }

    // Fresh cache → skip the network round-trip entirely.
    if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return

    // 2) Refresh from relays (also the only path when there's no cache). Paginate
    // each relay independently (past per-query caps) for the complete history.
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const fetched = await fetchAllEvents(
        relays,
        { kinds: [LEGACY_MOD_KIND], '#t': [LEGACY_GAMEMOD_TAG] },
        { pageSize: PAGE, maxRounds: MAX_ROUNDS },
      )

      // A cold/blocked fetch can return nothing — with no cache to fall back on,
      // leave loaded=false so the next visit retries instead of caching "empty".
      if (fetched.length === 0) {
        if (cachedByCoord.size === 0) set({ loading: false })
        return
      }

      // Union cache + fresh (newest per coordinate) so a transient short fetch
      // never drops mods we already had.
      const merged = dedupeByCoord([...cachedByCoord.values(), ...fetched])
      set({ mods: toMods(merged), loaded: true, loading: false })
      await writeCache([...merged.values()])
    } catch {
      if (cachedByCoord.size === 0) set({ loading: false })
    }
  },
}))
