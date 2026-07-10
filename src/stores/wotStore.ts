/**
 * Web of Trust — personal trust scoring from your social graph.
 *
 * Ported from DEN Chat. Scores a pubkey using people in your graph:
 *   +1 for each graph member who follows them
 *   -1 for each graph member who publicly mutes them (kind 10000)
 *   +1 if they have a verified DNN ID (toggleable)
 *
 * Overrides: anyone you directly follow is never hidden; yourself is never
 * hidden. The graph is seeded from YOUR follows only (personal WoT) and
 * optionally expanded to follows-of-follows up to `followDepth`.
 *
 * Settings persist to localStorage; the (large) graph persists to IndexedDB so
 * the user doesn't rebuild from scratch on every visit.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Event as NostrEvent } from 'nostr-tools'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useFollowsStore } from '@/stores/followsStore'
import { useDnnStore } from '@/stores/dnnStore'
import { loadWotGraph, saveWotGraph, clearWotGraph } from '@/lib/storage/wotCache'

/* ─── Constants ─── */

const SCORE_CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const GRAPH_BATCH_SIZE = 50
const MAX_GRAPH_SIZE = 5000
const REFRESH_STALE_MS = 30 * 60 * 1000 // refresh in background if older than 30 min

export const WOT_THRESHOLD_MIN = -5
export const WOT_THRESHOLD_MAX = 5
export const WOT_DEPTH_MAX = 3

/* ─── Types ─── */

export type WotContext = 'mods' | 'comments'

export interface WotSettings {
  scoreThreshold: number // -5..+5, default 0
  followDepth: number    // 0..3, default 1
  dnnBonus: boolean      // verified DNN ID = +1, default true
  applyMods: boolean     // filter mod listings, default true
  applyComments: boolean // filter comments, default true
}

interface EventSnapshot { id: string; created_at: number }

interface GraphData {
  follows: Map<string, Set<string>>
  publicMutes: Map<string, Set<string>>
  followEventSnapshots: Map<string, EventSnapshot>
  muteEventSnapshots: Map<string, EventSnapshot>
  builtDepth: number
  builtAt: number
  depthLevelPubkeys: Map<number, Set<string>>
}

interface PersistedGraph {
  version: number
  owner: string
  follows: [string, string[]][]
  publicMutes: [string, string[]][]
  followSnapshots: [string, EventSnapshot][]
  muteSnapshots: [string, EventSnapshot][]
  builtDepth: number
  builtAt: number
  depthLevelPubkeys: [number, string[]][]
}

export interface WotState {
  settings: WotSettings
  building: boolean
  graphDepth: number
  graphSize: number
  buildPhase: string
  buildProgress: number
  buildTotal: number
  buildDepthTarget: number
  buildDepthCurrent: number
  /** Bumped whenever scores may have changed — use as a memo dependency. */
  lastUpdated: number

  updateSettings: (partial: Partial<WotSettings>) => void
  getScore: (pubkey: string) => number
  /** Should this pubkey be hidden in `context`? Honors apply toggles + bypasses. */
  shouldHide: (pubkey: string, context: WotContext) => boolean
  /** Below threshold (ignores apply toggles) — for "how many would be hidden". */
  isLowTrust: (pubkey: string) => boolean
  buildGraph: () => Promise<void>
  refreshGraph: () => Promise<void>
  /** Load cached graph + kick a background build/refresh. Idempotent per session. */
  init: () => Promise<void>
}

const DEFAULT_SETTINGS: WotSettings = {
  scoreThreshold: 0,
  followDepth: 1,
  dnnBonus: true,
  applyMods: true,
  applyComments: true,
}

/* ─── Module-level graph + caches ─── */

let graphData: GraphData = emptyGraph()
const scoreCache = new Map<string, { score: number; computedAt: number }>()
let owner = ''
let initialized = false

function emptyGraph(): GraphData {
  return {
    follows: new Map(),
    publicMutes: new Map(),
    followEventSnapshots: new Map(),
    muteEventSnapshots: new Map(),
    builtDepth: -1,
    builtAt: 0,
    depthLevelPubkeys: new Map(),
  }
}

function getRelays(): string[] {
  return useSettingsStore.getState().getAllEnabledRelayUrls('read')
}

function myFollowSet(): Set<string> {
  const ev = useFollowsStore.getState().contactEvent
  const set = new Set<string>()
  if (ev) for (const t of ev.tags) if (t[0] === 'p' && t[1]) set.add(t[1])
  return set
}

/* ─── Relay fetch helpers ─── */

async function fetchFollowLists(
  pubkeys: string[],
  onBatch?: (processed: number, total: number) => void,
): Promise<Map<string, NostrEvent>> {
  const result = new Map<string, NostrEvent>()
  if (pubkeys.length === 0) return result
  const relays = getRelays()
  let processed = 0
  for (let i = 0; i < pubkeys.length; i += GRAPH_BATCH_SIZE) {
    const batch = pubkeys.slice(i, i + GRAPH_BATCH_SIZE)
    try {
      const events = await fetchEvents(relays, { kinds: [3], authors: batch, limit: batch.length }, 8000)
      for (const ev of events) {
        const existing = result.get(ev.pubkey)
        if (!existing || ev.created_at > existing.created_at) result.set(ev.pubkey, ev)
      }
    } catch { /* skip batch */ }
    processed += batch.length
    onBatch?.(processed, pubkeys.length)
  }
  return result
}

async function fetchPublicMuteLists(
  pubkeys: string[],
  onBatch?: (processed: number, total: number) => void,
): Promise<Map<string, { event: NostrEvent; muted: Set<string> }>> {
  const result = new Map<string, { event: NostrEvent; muted: Set<string> }>()
  if (pubkeys.length === 0) return result
  const relays = getRelays()
  let processed = 0
  for (let i = 0; i < pubkeys.length; i += GRAPH_BATCH_SIZE) {
    const batch = pubkeys.slice(i, i + GRAPH_BATCH_SIZE)
    try {
      const events = await fetchEvents(relays, { kinds: [10000], authors: batch, limit: batch.length }, 8000)
      for (const ev of events) {
        const existing = result.get(ev.pubkey)
        if (!existing || ev.created_at > existing.event.created_at) {
          const muted = new Set<string>()
          for (const t of ev.tags) if (t[0] === 'p' && t[1]) muted.add(t[1])
          result.set(ev.pubkey, { event: ev, muted })
        }
      }
    } catch { /* skip batch */ }
    processed += batch.length
    onBatch?.(processed, pubkeys.length)
  }
  return result
}

/* ─── Persistence ─── */

async function persistGraph() {
  const data: PersistedGraph = {
    version: 1,
    owner,
    follows: Array.from(graphData.follows, ([k, v]) => [k, Array.from(v)]),
    publicMutes: Array.from(graphData.publicMutes, ([k, v]) => [k, Array.from(v)]),
    followSnapshots: Array.from(graphData.followEventSnapshots),
    muteSnapshots: Array.from(graphData.muteEventSnapshots),
    builtDepth: graphData.builtDepth,
    builtAt: graphData.builtAt,
    depthLevelPubkeys: Array.from(graphData.depthLevelPubkeys, ([k, v]) => [k, Array.from(v)]),
  }
  await saveWotGraph(data)
}

function hydrateGraph(p: PersistedGraph) {
  owner = p.owner
  graphData = {
    follows: new Map(p.follows.map(([k, v]) => [k, new Set(v)])),
    publicMutes: new Map(p.publicMutes.map(([k, v]) => [k, new Set(v)])),
    followEventSnapshots: new Map(p.followSnapshots),
    muteEventSnapshots: new Map(p.muteSnapshots),
    builtDepth: p.builtDepth,
    builtAt: p.builtAt,
    depthLevelPubkeys: new Map(p.depthLevelPubkeys.map(([k, v]) => [k, new Set(v)])),
  }
}

/* ─── Store ─── */

export const useWotStore = create<WotState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      building: false,
      graphDepth: -1,
      graphSize: 0,
      buildPhase: '',
      buildProgress: 0,
      buildTotal: 0,
      buildDepthTarget: 0,
      buildDepthCurrent: 0,
      lastUpdated: 0,

      updateSettings: (partial) => {
        const next = { ...get().settings, ...partial }
        const depthIncreased = partial.followDepth !== undefined && partial.followDepth > graphData.builtDepth
        scoreCache.clear()
        set({ settings: next, lastUpdated: Date.now() })
        if (depthIncreased && !get().building) get().buildGraph()
      },

      getScore: (pubkey) => {
        const now = Date.now()
        const cached = scoreCache.get(pubkey)
        if (cached && now - cached.computedAt < SCORE_CACHE_TTL) return cached.score

        const { settings } = get()
        let score = 0

        const graphPubkeys = new Set<string>()
        const myFollows = myFollowSet()
        for (const pk of myFollows) graphPubkeys.add(pk)

        if (settings.followDepth >= 1) {
          const expand = (sources: Set<string>, depth: number) => {
            if (depth > settings.followDepth || graphPubkeys.size >= MAX_GRAPH_SIZE) return
            const nextSources = new Set<string>()
            for (const source of sources) {
              const theirFollows = graphData.follows.get(source)
              if (!theirFollows) continue
              for (const pk of theirFollows) {
                if (!graphPubkeys.has(pk)) {
                  graphPubkeys.add(pk)
                  nextSources.add(pk)
                  if (graphPubkeys.size >= MAX_GRAPH_SIZE) return
                }
              }
            }
            if (nextSources.size > 0 && depth + 1 <= settings.followDepth) expand(nextSources, depth + 1)
          }
          expand(myFollows, 1)
        }

        for (const pk of graphPubkeys) {
          if (graphData.follows.get(pk)?.has(pubkey)) score += 1
        }
        for (const pk of graphPubkeys) {
          if (graphData.publicMutes.get(pk)?.has(pubkey)) score -= 1
        }
        // My own follows' mutes always count, even at depth 0.
        for (const pk of myFollows) {
          if (!graphPubkeys.has(pk) && graphData.publicMutes.get(pk)?.has(pubkey)) score -= 1
        }

        if (settings.dnnBonus && useDnnStore.getState().isVerified(pubkey)) score += 1

        scoreCache.set(pubkey, { score, computedAt: now })
        return score
      },

      isLowTrust: (pubkey) => {
        const me = useAuthStore.getState().pubkey
        if (pubkey === me) return false
        if (myFollowSet().has(pubkey)) return false
        return get().getScore(pubkey) < get().settings.scoreThreshold
      },

      shouldHide: (pubkey, context) => {
        const { settings } = get()
        if (context === 'mods' && !settings.applyMods) return false
        if (context === 'comments' && !settings.applyComments) return false
        return get().isLowTrust(pubkey)
      },

      buildGraph: async () => {
        if (get().building) return
        const { settings } = get()
        const myFollows = myFollowSet()
        const myFollowsArr = Array.from(myFollows)
        const targetDepth = settings.followDepth
        const startFromDepth = graphData.builtDepth + 1

        if (graphData.builtDepth >= targetDepth && graphData.builtDepth >= 0) {
          scoreCache.clear()
          set({ graphDepth: graphData.builtDepth, graphSize: graphData.follows.size, lastUpdated: Date.now() })
          return
        }
        if (myFollowsArr.length === 0) return

        set({
          building: true,
          buildPhase: startFromDepth === 0 ? 'Fetching follow lists…' : `Resuming from depth ${startFromDepth}…`,
          buildProgress: 0, buildTotal: myFollowsArr.length,
          buildDepthTarget: targetDepth, buildDepthCurrent: Math.max(0, startFromDepth),
        })

        try {
          if (graphData.builtDepth < 0) {
            set({ buildPhase: 'Fetching follow lists…', buildProgress: 0, buildTotal: myFollowsArr.length, buildDepthCurrent: 0 })
            const followEvents = await fetchFollowLists(myFollowsArr, (p, t) => set({ buildProgress: p, buildTotal: t }))
            set({ buildPhase: 'Fetching mute lists…', buildProgress: 0, buildTotal: myFollowsArr.length })
            const muteData = await fetchPublicMuteLists(myFollowsArr, (p, t) => set({ buildProgress: p, buildTotal: t }))

            for (const [pk, ev] of followEvents) {
              const follows = new Set<string>()
              for (const t of ev.tags) if (t[0] === 'p' && t[1]) follows.add(t[1])
              graphData.follows.set(pk, follows)
              graphData.followEventSnapshots.set(pk, { id: ev.id, created_at: ev.created_at })
            }
            for (const [pk, data] of muteData) {
              graphData.publicMutes.set(pk, data.muted)
              graphData.muteEventSnapshots.set(pk, { id: data.event.id, created_at: data.event.created_at })
            }
            graphData.builtDepth = 0
            graphData.depthLevelPubkeys.set(0, myFollows)
            set({ graphDepth: 0, graphSize: graphData.follows.size })
          }

          if (targetDepth >= 1) {
            let currentLevel = graphData.depthLevelPubkeys.get(graphData.builtDepth) || myFollows
            const allKnown = new Set<string>(graphData.follows.keys())
            for (const pk of myFollowsArr) allKnown.add(pk)
            const resumeDepth = Math.max(1, graphData.builtDepth + 1)

            for (let depth = resumeDepth; depth <= targetDepth; depth++) {
              if (graphData.depthLevelPubkeys.has(depth)) {
                currentLevel = graphData.depthLevelPubkeys.get(depth)!
                for (const pk of currentLevel) allKnown.add(pk)
                graphData.builtDepth = depth
                set({ graphDepth: depth, graphSize: graphData.follows.size, buildDepthCurrent: depth })
                continue
              }
              const nextLevel = new Set<string>()
              for (const pk of currentLevel) {
                const theirFollows = graphData.follows.get(pk)
                if (!theirFollows) continue
                for (const fpk of theirFollows) {
                  if (!allKnown.has(fpk)) {
                    nextLevel.add(fpk)
                    allKnown.add(fpk)
                    if (allKnown.size >= MAX_GRAPH_SIZE) break
                  }
                }
                if (allKnown.size >= MAX_GRAPH_SIZE) break
              }
              if (nextLevel.size === 0) break

              const arr = Array.from(nextLevel)
              set({ buildPhase: `Depth ${depth}: fetching follow lists…`, buildProgress: 0, buildTotal: arr.length, buildDepthCurrent: depth })
              const fEvents = await fetchFollowLists(arr, (p, t) => set({ buildProgress: p, buildTotal: t, graphSize: graphData.follows.size }))
              set({ buildPhase: `Depth ${depth}: fetching mute lists…`, buildProgress: 0, buildTotal: arr.length })
              const mData = await fetchPublicMuteLists(arr, (p, t) => set({ buildProgress: p, buildTotal: t }))

              for (const [pk, ev] of fEvents) {
                const follows = new Set<string>()
                for (const t of ev.tags) if (t[0] === 'p' && t[1]) follows.add(t[1])
                graphData.follows.set(pk, follows)
                graphData.followEventSnapshots.set(pk, { id: ev.id, created_at: ev.created_at })
              }
              for (const [pk, data] of mData) {
                graphData.publicMutes.set(pk, data.muted)
                graphData.muteEventSnapshots.set(pk, { id: data.event.id, created_at: data.event.created_at })
              }
              graphData.builtDepth = depth
              graphData.depthLevelPubkeys.set(depth, nextLevel)
              currentLevel = nextLevel
              set({ graphDepth: depth, graphSize: graphData.follows.size })
              await new Promise((r) => setTimeout(r, 80))
            }
          }

          graphData.builtAt = Date.now()
          scoreCache.clear()
          owner = useAuthStore.getState().pubkey || owner
          set({
            building: false, graphDepth: graphData.builtDepth, graphSize: graphData.follows.size,
            buildPhase: '', buildProgress: 0, buildTotal: 0, lastUpdated: Date.now(),
          })
          persistGraph()
        } catch {
          set({ building: false, buildPhase: '', buildProgress: 0, buildTotal: 0 })
        }
      },

      refreshGraph: async () => {
        if (get().building) return
        const myFollowsArr = Array.from(myFollowSet())
        if (graphData.builtDepth < 0) return get().buildGraph()

        const allGraphPubkeys = Array.from(graphData.follows.keys())
        if (allGraphPubkeys.length === 0) return get().buildGraph()

        set({ building: true, buildPhase: 'Checking for changes…' })
        try {
          let changed = 0
          const freshFollows = await fetchFollowLists(allGraphPubkeys)
          for (const [pk, ev] of freshFollows) {
            const snap = graphData.followEventSnapshots.get(pk)
            if (!snap || snap.id !== ev.id || snap.created_at !== ev.created_at) {
              const follows = new Set<string>()
              for (const t of ev.tags) if (t[0] === 'p' && t[1]) follows.add(t[1])
              graphData.follows.set(pk, follows)
              graphData.followEventSnapshots.set(pk, { id: ev.id, created_at: ev.created_at })
              changed++
            }
          }
          const freshMutes = await fetchPublicMuteLists(allGraphPubkeys)
          for (const [pk, data] of freshMutes) {
            const snap = graphData.muteEventSnapshots.get(pk)
            if (!snap || snap.id !== data.event.id || snap.created_at !== data.event.created_at) {
              graphData.publicMutes.set(pk, data.muted)
              graphData.muteEventSnapshots.set(pk, { id: data.event.id, created_at: data.event.created_at })
              changed++
            }
          }
          // New follows we don't have yet → full rebuild to pick them up.
          if (myFollowsArr.some((pk) => !graphData.follows.has(pk))) {
            set({ building: false })
            return get().buildGraph()
          }
          if (changed > 0) scoreCache.clear()
          graphData.builtAt = Date.now()
          set({ building: false, buildPhase: '', graphSize: graphData.follows.size, lastUpdated: Date.now() })
          persistGraph()
        } catch {
          set({ building: false, buildPhase: '' })
        }
      },

      init: async () => {
        const pubkey = useAuthStore.getState().pubkey
        if (!pubkey) return // wait until logged in; init() may be called again later
        if (initialized && owner === pubkey) return
        initialized = true

        // Load the cached graph once (before we know the owner).
        if (graphData.builtDepth < 0 && !owner) {
          const cached = await loadWotGraph<PersistedGraph>()
          if (cached && cached.version === 1) hydrateGraph(cached)
        }

        await useFollowsStore.getState().loadContacts()

        // Cached graph belongs to a different account — start fresh.
        if (owner && owner !== pubkey) {
          graphData = emptyGraph()
          scoreCache.clear()
          await clearWotGraph()
        }
        owner = pubkey

        set({ graphDepth: graphData.builtDepth, graphSize: graphData.follows.size })

        if (graphData.builtDepth < 0) {
          get().buildGraph()
        } else if (Date.now() - graphData.builtAt > REFRESH_STALE_MS) {
          get().refreshGraph()
        } else {
          set({ lastUpdated: Date.now() })
        }
      },
    }),
    {
      name: 'deg-mods:wot',
      partialize: (s) => ({ settings: s.settings }),
    },
  ),
)
