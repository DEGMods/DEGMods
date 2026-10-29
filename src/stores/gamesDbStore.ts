import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { idbStorage } from '@/lib/storage/idbStorage'

// One-time cleanup: the games DB used to persist to localStorage, where ~170k
// games blow past the ~5 MB quota. It now lives in IndexedDB — drop the stale
// (and partial) localStorage entry so it stops eating quota.
try { localStorage.removeItem('deg-mods-games-db') } catch { /* ignore */ }
import type { GameEntry } from '@/types/game'
import { KINDS, ADMIN_PUBKEY } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { downloadFile } from '@/lib/blossom/client'
import { parseCsvLine } from '@/lib/csv'
import { rankByQuery, alphabetical } from '@/lib/search'

type SyncPhase = 'idle' | 'checking' | 'downloading' | 'done' | 'error'

interface GamesDbState {
  games: GameEntry[]
  /** Parsed entries grouped by their source CSV blob hash, so a changed shard can
   *  be swapped without touching (or re-downloading) the others. Derived `games`
   *  is the flattened, name-deduped union. */
  byHash: Record<string, GameEntry[]>
  /** Current CSV hashes in event order (doubles as the dedup precedence order). */
  csvHashes: string[]
  lastUpdated: number
  loading: boolean
  error: string | null

  // Transient (not persisted) — surfaces background-sync progress to the UI.
  syncPhase: SyncPhase
  syncDone: number
  syncTotal: number

  syncGamesDb: (
    relayUrls: string[],
    blossomUrls: string[],
    adminPubkey: string
  ) => Promise<void>
  searchGames: (query: string) => GameEntry[]
  getGameImages: (
    name: string
  ) => { wideImage?: string; boxartImage?: string } | null
  getAllGames: () => GameEntry[]
}

function parseCsv(text: string): GameEntry[] {
  const lines = text.split('\n').slice(1) // skip header
  const results: GameEntry[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const fields = parseCsvLine(line)
    const name = fields[0] || ''
    const wideImage = fields[1] || ''
    const boxartImage = fields[2] || ''
    if (!name) continue
    results.push({
      name,
      wideImage: wideImage || undefined,
      boxartImage: boxartImage || undefined,
    })
  }
  return results
}

/** Flatten the per-shard groups into one list, deduped by name. Shards are applied
 *  in `order` (the event's CSV-tag order), so a later shard overrides an earlier
 *  one on a name collision — deterministic, unlike concatenation order. */
function flatten(byHash: Record<string, GameEntry[]>, order: string[]): GameEntry[] {
  const map = new Map<string, GameEntry>()
  const add = (h: string) => {
    const entries = byHash[h]
    if (entries) for (const g of entries) map.set(g.name.toLowerCase(), g)
  }
  for (const h of order) add(h)
  for (const h of Object.keys(byHash)) if (!order.includes(h)) add(h) // defensive
  return Array.from(map.values())
}

async function downloadCsvFromBlossom(
  hash: string,
  blossomUrls: string[]
): Promise<string> {
  for (const blossomUrl of blossomUrls) {
    try {
      const url = `${blossomUrl.replace(/\/$/, '')}/${hash}`
      const blob = await downloadFile(url)
      return await blob.text()
    } catch {
      // Try next blossom server
    }
  }
  throw new Error(`Failed to download CSV ${hash} from any blossom server`)
}

export const useGamesDbStore = create<GamesDbState>()(
  persist(
    (set, get) => ({
      games: [],
      byHash: {},
      csvHashes: [],
      lastUpdated: 0,
      loading: false,
      error: null,
      syncPhase: 'idle',
      syncDone: 0,
      syncTotal: 0,

      syncGamesDb: async (relayUrls, blossomUrls, adminPubkey) => {
        set({ loading: true, error: null, syncPhase: 'checking', syncDone: 0, syncTotal: 0 })

        try {
          // Find the NEWEST revision of the games-db event across relays, with the
          // multi-pass safeguard (a fast relay can serve a STALE copy while the
          // relay holding the current one is slow on a cold start).
          const event = await fetchLatestEvent(relayUrls, {
            kinds: [KINDS.GAME_DB],
            authors: [adminPubkey],
            '#d': ['games-db']
          })

          if (!event) {
            // Don't wipe a set we already have on a transient miss — keep games,
            // surface the error, and let the next visit retry. Be honest about
            // whether this is a hard failure or just a background refresh miss.
            const haveGames = get().games.length > 0
            set({
              loading: false,
              syncPhase: 'error',
              error: relayUrls.length === 0
                ? 'No read relays enabled'
                : haveGames
                  ? 'Couldn’t refresh from relays — showing cached list, will retry'
                  : 'Could not reach the games database (no relay had it) — will retry'
            })
            return
          }

          const newHashes = event.tags
            .filter((t) => t[0] === 'csv')
            .map((t) => t[1])
            .filter(Boolean)

          const byHash = get().byHash
          // A changed shard gets a NEW content hash, so "updated" == a hash we don't
          // have yet. Everything already in byHash and still listed is reused as-is —
          // no re-download. Hashes no longer listed are simply dropped.
          const toDownload = newHashes.filter((h) => !byHash[h])
          const removed = Object.keys(byHash).filter((h) => !newHashes.includes(h))

          if (toDownload.length === 0 && removed.length === 0) {
            // Same shards — nothing to fetch. Re-flatten in case only the order changed.
            set({
              loading: false,
              lastUpdated: Date.now(),
              syncPhase: 'done',
              csvHashes: newHashes,
              games: flatten(byHash, newHashes),
            })
            return
          }

          // Download only the new/changed shards (in parallel, with per-CSV blossom
          // failover inside downloadCsvFromBlossom). A single unreachable shard must
          // NOT abort the sync — skip it (it stays untracked so it's retried next
          // sync) and keep everything else. Track progress as each resolves.
          set({ syncPhase: 'downloading', syncTotal: toDownload.length, syncDone: 0 })
          const bumpDone = () => set((s) => ({ syncDone: s.syncDone + 1 }))
          const downloaded = (await Promise.all(
            toDownload.map(async (hash) => {
              try { return { hash, text: await downloadCsvFromBlossom(hash, blossomUrls) } }
              catch (e) { console.warn(`games-db: CSV ${hash.slice(0, 8)}… unreachable, skipping`, e); return null }
              finally { bumpDone() }
            }),
          )).filter((x): x is { hash: string; text: string } => x !== null)

          // Rebuild the shard map: reuse unchanged shards verbatim, drop removed ones,
          // add the freshly downloaded ones. Any shard we failed to download is left
          // out so it's retried next sync (rather than assumed present).
          const nextByHash: Record<string, GameEntry[]> = {}
          for (const h of newHashes) if (byHash[h]) nextByHash[h] = byHash[h]
          for (const d of downloaded) nextByHash[d.hash] = parseCsv(d.text)
          const loadedOrder = newHashes.filter((h) => nextByHash[h])

          set({
            byHash: nextByHash,
            csvHashes: loadedOrder,
            games: flatten(nextByHash, loadedOrder),
            lastUpdated: Date.now(),
            loading: false,
            error: null,
            syncPhase: 'done'
          })

          // Help keep the CSV blobs replicated across Blossom servers (logged-in
          // only — re-mirroring needs a signed auth). Fire-and-forget.
          import('@/lib/blossom/blobRedundancy')
            .then((m) => m.ensureBlobsReplicated(loadedOrder))
            .catch(() => { /* non-critical */ })
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to sync games database'
          set({ loading: false, error: message, syncPhase: 'error' })
        }
      },

      searchGames: (query) => {
        if (!query.trim()) return []
        // Closest (prefix) matches first, then alphabetical — same ordering as the
        // /games page and the /submit-mod autocomplete.
        return rankByQuery(get().games, query, (g) => g.name, (a, b) => alphabetical(a.name, b.name)).slice(0, 20)
      },

      getGameImages: (name) => {
        const game = get().games.find(
          (g) => g.name.toLowerCase() === name.toLowerCase()
        )
        if (!game) return null
        return {
          wideImage: game.wideImage,
          boxartImage: game.boxartImage
        }
      },

      getAllGames: () => {
        return get().games
      }
    }),
    {
      name: 'deg-mods-games-db',
      version: 1,
      storage: createJSONStorage(() => idbStorage), // IndexedDB — localStorage is too small for ~170k games
      // Persist the per-shard groups + hash order; `games` is derived from them on
      // rehydrate (below), so we don't store the flattened union twice.
      partialize: (state) => ({
        byHash: state.byHash,
        csvHashes: state.csvHashes,
        lastUpdated: state.lastUpdated
      }),
      migrate: (persisted, version) => {
        if (version < 1) {
          // v0 stored a flat { games, csvHashes } with no per-shard grouping, so
          // byHash can't be reconstructed. Start empty and force one full resync.
          return { byHash: {}, csvHashes: [], lastUpdated: 0 } as Partial<GamesDbState>
        }
        return persisted as Partial<GamesDbState>
      },
      onRehydrateStorage: () => (state) => {
        if (state) state.games = flatten(state.byHash ?? {}, state.csvHashes ?? [])
      }
    }
  )
)

const GAMES_SYNC_TTL = 5 * 60 * 1000

/**
 * Warm the games DB in the background — safe to call from anywhere (app startup,
 * the /games page). It's idempotent: hydration-gated (won't sync against empty
 * pre-hydration state), throttled (skips if we synced within GAMES_SYNC_TTL),
 * and no-ops while a sync is already running. The heavy CSV download only
 * happens on the first ever load or when a shard actually changes; after that
 * it's a single cheap event fetch — so calling it on every startup is fine.
 *
 * Kicking this off at startup (regardless of route) means the games are usually
 * already in IndexedDB by the time the user opens /games.
 */
export function warmGamesDb(): void {
  const store = useGamesDbStore
  const run = () => {
    const s = store.getState()
    if (s.loading || !ADMIN_PUBKEY) return
    if (s.games.length > 0 && Date.now() - s.lastUpdated < GAMES_SYNC_TTL) return
    const settings = useSettingsStore.getState()
    const relayUrls = settings.getAllEnabledRelayUrls('read')
    const blossomUrls = settings.getAllEnabledBlossomUrls()
    s.syncGamesDb(relayUrls, blossomUrls, ADMIN_PUBKEY)
  }
  if (store.persist.hasHydrated()) run()
  else store.persist.onFinishHydration(run)
}
