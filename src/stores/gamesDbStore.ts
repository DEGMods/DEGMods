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

type SyncPhase = 'idle' | 'checking' | 'downloading' | 'done' | 'error'

interface GamesDbState {
  games: GameEntry[]
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

          const currentHashes = get().csvHashes
          const changedHashes = newHashes.filter(
            (h) => !currentHashes.includes(h)
          )
          const removedHashes = currentHashes.filter(
            (h) => !newHashes.includes(h)
          )

          // If nothing changed, just update timestamp
          if (changedHashes.length === 0 && removedHashes.length === 0) {
            set({ loading: false, lastUpdated: Date.now(), syncPhase: 'done' })
            return
          }

          // Download changed CSVs in parallel. A single unreachable CSV must NOT
          // abort the whole sync — skip it (it stays untracked so it's retried
          // next sync) and load everything else. Track progress as each resolves.
          set({ syncPhase: 'downloading', syncTotal: changedHashes.length, syncDone: 0 })
          const bumpDone = () => set((s) => ({ syncDone: s.syncDone + 1 }))
          const newCsvTexts = (await Promise.all(
            changedHashes.map(async (hash) => {
              try { return { hash, text: await downloadCsvFromBlossom(hash, blossomUrls) } }
              catch (e) { console.warn(`games-db: CSV ${hash.slice(0, 8)}… unreachable, skipping`, e); return null }
              finally { bumpDone() }
            }),
          )).filter((x): x is { hash: string; text: string } => x !== null)
          const okChangedHashes = newCsvTexts.map((f) => f.hash)

          // Parse new CSV entries
          const newEntries = newCsvTexts.flatMap((f) => parseCsv(f.text))

          // Keep entries from unchanged hashes
          const unchangedHashes = currentHashes.filter(
            (h) => !removedHashes.includes(h) && !changedHashes.includes(h)
          )

          // For unchanged hashes we keep the existing games.
          // Re-download would be wasteful, so we keep existing entries
          // and merge with new ones, deduplicating by name.
          const existingGames = get().games
          const allEntries = [...existingGames, ...newEntries]

          // Deduplicate by name (case-insensitive), last occurrence wins
          const deduped = new Map<string, GameEntry>()
          for (const entry of allEntries) {
            deduped.set(entry.name.toLowerCase(), entry)
          }

          // If hashes were removed, re-filter: only keep games that
          // came from still-valid CSVs. Since we don't track per-game
          // source, on removal we rebuild from all current hashes.
          let finalGames: GameEntry[]
          let okKeptHashes = unchangedHashes
          if (removedHashes.length > 0) {
            // Re-download unchanged hashes to rebuild (parallel, skip unreachable).
            set((s) => ({ syncTotal: s.syncTotal + unchangedHashes.length }))
            const keptTexts = (await Promise.all(
              unchangedHashes.map(async (hash) => {
                try { return { hash, text: await downloadCsvFromBlossom(hash, blossomUrls) } }
                catch (e) { console.warn(`games-db: CSV ${hash.slice(0, 8)}… unreachable, skipping`, e); return null }
                finally { bumpDone() }
              }),
            )).filter((x): x is { hash: string; text: string } => x !== null)
            okKeptHashes = keptTexts.map((f) => f.hash)
            const keptEntries = keptTexts.flatMap((f) => parseCsv(f.text))
            const merged = [...keptEntries, ...newEntries]
            const rebuiltMap = new Map<string, GameEntry>()
            for (const entry of merged) {
              rebuiltMap.set(entry.name.toLowerCase(), entry)
            }
            finalGames = Array.from(rebuiltMap.values())
          } else {
            finalGames = Array.from(deduped.values())
          }

          // Only track hashes we actually loaded, so skipped/unreachable CSVs
          // are retried on the next sync rather than assumed present.
          set({
            games: finalGames,
            csvHashes: [...okKeptHashes, ...okChangedHashes],
            lastUpdated: Date.now(),
            loading: false,
            error: null,
            syncPhase: 'done'
          })
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to sync games database'
          set({ loading: false, error: message, syncPhase: 'error' })
        }
      },

      searchGames: (query) => {
        if (!query.trim()) return []
        const q = query.toLowerCase()
        return get()
          .games.filter((g) => g.name.toLowerCase().includes(q))
          .slice(0, 20)
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
      storage: createJSONStorage(() => idbStorage), // IndexedDB — localStorage is too small for ~170k games
      partialize: (state) => ({
        games: state.games,
        csvHashes: state.csvHashes,
        lastUpdated: state.lastUpdated
      })
    }
  )
)

const GAMES_SYNC_TTL = 5 * 60 * 1000

/**
 * Warm the games DB in the background — safe to call from anywhere (app startup,
 * the /games page). It's idempotent: hydration-gated (won't sync against empty
 * pre-hydration state), throttled (skips if we synced within GAMES_SYNC_TTL),
 * and no-ops while a sync is already running. The heavy CSV download only
 * happens on the first ever load or when the DB actually changes; after that
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
