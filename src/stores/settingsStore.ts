/**
 * Settings Store: relays, blossom servers, DNN nodes, PoW
 *
 * Three tiers for relays and blossom:
 * 1. Client defaults (built-in, can be toggled)
 * 2. User's published list (from Nostr events, can be toggled)
 * 3. User-added custom entries (can be added/removed/toggled)
 */

import { create } from 'zustand'
import {
  StorageKey,
  KINDS,
  DEFAULT_RELAYS,
  DEFAULT_BLOSSOMS,
  DEFAULT_DNN_NODES,
  type RelayConfig,
  type BlossomConfig,
  type DnnNodeConfig,
} from '@/lib/constants'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import type { Event as NostrEvent } from 'nostr-tools'

/** Membership signature of a relay list (url + read/write), ignoring the local enabled toggle. */
export function relayListSignature(relays: RelayConfig[]): string {
  return relays.map(r => `${r.url}|${r.read ? 'r' : ''}${r.write ? 'w' : ''}`).sort().join(',')
}
/** Membership signature of a blossom list (url only). */
export function blossomListSignature(servers: BlossomConfig[]): string {
  return servers.map(s => s.url).sort().join(',')
}

function parseRelayList(ev: NostrEvent): RelayConfig[] {
  const seen = new Set<string>()
  const out: RelayConfig[] = []
  for (const t of ev.tags) {
    if (t[0] !== 'r' || !t[1] || seen.has(t[1])) continue
    seen.add(t[1])
    const marker = t[2]
    out.push({ url: t[1], read: !marker || marker === 'read', write: !marker || marker === 'write', enabled: true })
  }
  return out
}
function parseBlossomList(ev: NostrEvent): BlossomConfig[] {
  const seen = new Set<string>()
  const out: BlossomConfig[] = []
  for (const t of ev.tags) {
    if (t[0] !== 'server' || !t[1] || seen.has(t[1])) continue
    seen.add(t[1])
    out.push({ url: t[1], enabled: true })
  }
  return out
}

export interface SettingsState {
  // ─── Relays ─────────────────────────────────────────────────
  clientRelays: RelayConfig[]
  userRelays: RelayConfig[]
  customRelays: RelayConfig[]
  /** Whether a published kind 10002 relay list was found for the user. */
  userRelaysFound: boolean
  /** Membership signature of the last published relay list (for dirty detection). */
  userRelaysBaseline: string

  // ─── Blossom ────────────────────────────────────────────────
  clientBlossoms: BlossomConfig[]
  userBlossoms: BlossomConfig[]
  customBlossoms: BlossomConfig[]
  userBlossomsFound: boolean
  userBlossomsBaseline: string

  // ─── DNN ────────────────────────────────────────────────────
  defaultDnnNodes: DnnNodeConfig[]
  userDnnNodes: DnnNodeConfig[]
  discoveredDnnNodes: DnnNodeConfig[]

  // ─── PoW ────────────────────────────────────────────────────
  // ─── Posting behaviour ──────────────────────────────────────
  postToClientRelays: boolean
  postToUserRelays: boolean
  postToCustomRelays: boolean
  limitRelaysPerList: boolean    // randomly cap each write-relay list to 3
  limitBlossomsPerList: boolean  // cap each blossom list to 3
  parallelBlossomUpload: boolean // upload to up to 3 servers concurrently

  powDifficulty: number
  powFilterDifficulty: number
  blossomUploadLimitMb: number
  /** Max image download size (MB) before images render as a "too large" placeholder. 0 = unlimited. */
  mediaDownloadLimitMb: number

  // ─── Relay Methods ──────────────────────────────────────────
  toggleClientRelay: (url: string) => void
  toggleUserRelay: (url: string) => void
  toggleCustomRelay: (url: string) => void
  addCustomRelay: (relay: RelayConfig) => void
  removeCustomRelay: (url: string) => void
  setUserRelays: (relays: RelayConfig[]) => void
  addUserRelay: (relay: RelayConfig) => void
  removeUserRelay: (url: string) => void
  /** After a successful publish: adopt the current list as the new baseline. */
  markUserRelaysPublished: () => void

  // ─── Blossom Methods ───────────────────────────────────────
  toggleClientBlossom: (url: string) => void
  toggleUserBlossom: (url: string) => void
  toggleCustomBlossom: (url: string) => void
  addCustomBlossom: (server: BlossomConfig) => void
  removeCustomBlossom: (url: string) => void
  setUserBlossoms: (servers: BlossomConfig[]) => void
  addUserBlossom: (server: BlossomConfig) => void
  removeUserBlossom: (url: string) => void
  markUserBlossomsPublished: () => void

  // ─── User list loading ─────────────────────────────────────
  /** Fetch the user's published relay (10002) + blossom (10063) lists from Nostr. */
  loadUserLists: (pubkey: string) => Promise<void>
  resetUserLists: () => void

  // ─── DNN Methods ───────────────────────────────────────────
  toggleDnnNode: (url: string, tier: 'default' | 'user') => void
  addUserDnnNode: (node: DnnNodeConfig) => void
  removeUserDnnNode: (url: string) => void
  setDiscoveredDnnNodes: (nodes: DnnNodeConfig[]) => void

  // ─── PoW Methods ───────────────────────────────────────────
  setPostToClientRelays: (v: boolean) => void
  setPostToUserRelays: (v: boolean) => void
  setPostToCustomRelays: (v: boolean) => void
  setLimitRelaysPerList: (v: boolean) => void
  setLimitBlossomsPerList: (v: boolean) => void
  setParallelBlossomUpload: (v: boolean) => void

  setPowDifficulty: (difficulty: number) => void
  setPowFilterDifficulty: (difficulty: number) => void
  setBlossomUploadLimitMb: (limit: number) => void
  setMediaDownloadLimitMb: (limit: number) => void

  // ─── Computed Helpers ──────────────────────────────────────
  getAllEnabledRelayUrls: (mode?: 'read' | 'write' | 'both') => string[]
  getAllEnabledBlossomUrls: () => string[]

  // ─── Persistence ───────────────────────────────────────────
  loadFromStorage: () => void
  saveToStorage: () => void
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

// ─── Posting behaviour ──────────────────────────────────────────────
const POSTING_DEFAULTS = {
  postToClientRelays: true,
  postToUserRelays: true,
  postToCustomRelays: true,
  limitRelaysPerList: true,
  limitBlossomsPerList: true,
  parallelBlossomUpload: false,
}
type PostingBehaviour = typeof POSTING_DEFAULTS

function savePosting(s: PostingBehaviour) {
  localStorage.setItem(StorageKey.POSTING_BEHAVIOUR, JSON.stringify({
    postToClientRelays: s.postToClientRelays,
    postToUserRelays: s.postToUserRelays,
    postToCustomRelays: s.postToCustomRelays,
    limitRelaysPerList: s.limitRelaysPerList,
    limitBlossomsPerList: s.limitBlossomsPerList,
    parallelBlossomUpload: s.parallelBlossomUpload,
  }))
}

/** Pick up to `count` random items from an array (no-op if already ≤ count). */
function pickRandom<T>(arr: T[], count: number): T[] {
  if (arr.length <= count) return arr
  return [...arr].sort(() => Math.random() - 0.5).slice(0, count)
}

/** Append any built-in defaults the stored client list doesn't have yet (so
 *  newly-added defaults, e.g. search relays or the mod-file node, appear for
 *  existing users). Works for both relay and blossom lists. */
function withNewDefaults<T extends { url: string }>(stored: T[], defaults: T[]): T[] {
  const have = new Set(stored.map(r => r.url))
  return [...stored, ...defaults.filter(d => !have.has(d.url))]
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...POSTING_DEFAULTS,
  clientRelays: DEFAULT_RELAYS.map(r => ({ ...r })),
  userRelays: [],
  customRelays: [],
  userRelaysFound: false,
  userRelaysBaseline: '',
  clientBlossoms: DEFAULT_BLOSSOMS.map(b => ({ ...b })),
  userBlossoms: [],
  customBlossoms: [],
  userBlossomsFound: false,
  userBlossomsBaseline: '',
  defaultDnnNodes: DEFAULT_DNN_NODES.map(n => ({ ...n })),
  userDnnNodes: [],
  discoveredDnnNodes: [],
  powDifficulty: 15,
  powFilterDifficulty: 15,
  blossomUploadLimitMb: 10,
  mediaDownloadLimitMb: 10,

  // ─── Relay Methods ──────────────────────────────────────────

  toggleClientRelay: (url) => {
    set(s => ({ clientRelays: s.clientRelays.map(r => r.url === url ? { ...r, enabled: !r.enabled } : r) }))
    get().saveToStorage()
  },
  toggleUserRelay: (url) => {
    set(s => ({ userRelays: s.userRelays.map(r => r.url === url ? { ...r, enabled: !r.enabled } : r) }))
    get().saveToStorage()
  },
  toggleCustomRelay: (url) => {
    set(s => ({ customRelays: s.customRelays.map(r => r.url === url ? { ...r, enabled: !r.enabled } : r) }))
    get().saveToStorage()
  },
  addCustomRelay: (relay) => {
    set(s => ({ customRelays: [...s.customRelays, relay] }))
    get().saveToStorage()
  },
  removeCustomRelay: (url) => {
    set(s => ({ customRelays: s.customRelays.filter(r => r.url !== url) }))
    get().saveToStorage()
  },
  setUserRelays: (relays) => { set({ userRelays: relays }); get().saveToStorage() },
  addUserRelay: (relay) => {
    if (get().userRelays.some(r => r.url === relay.url)) return
    set(s => ({ userRelays: [...s.userRelays, relay] }))
    get().saveToStorage()
  },
  removeUserRelay: (url) => {
    set(s => ({ userRelays: s.userRelays.filter(r => r.url !== url) }))
    get().saveToStorage()
  },
  markUserRelaysPublished: () => {
    set(s => ({ userRelaysFound: true, userRelaysBaseline: relayListSignature(s.userRelays) }))
    get().saveToStorage()
  },

  // ─── Blossom Methods ───────────────────────────────────────

  toggleClientBlossom: (url) => {
    set(s => ({ clientBlossoms: s.clientBlossoms.map(b => b.url === url ? { ...b, enabled: !b.enabled } : b) }))
    get().saveToStorage()
  },
  toggleUserBlossom: (url) => {
    set(s => ({ userBlossoms: s.userBlossoms.map(b => b.url === url ? { ...b, enabled: !b.enabled } : b) }))
    get().saveToStorage()
  },
  toggleCustomBlossom: (url) => {
    set(s => ({ customBlossoms: s.customBlossoms.map(b => b.url === url ? { ...b, enabled: !b.enabled } : b) }))
    get().saveToStorage()
  },
  addCustomBlossom: (server) => {
    const clean = server.url.trim().replace(/\/+$/, '')
    if (!clean) return
    set(s => {
      // Don't add a host that's already present (in any list), even if it differs
      // only by a trailing slash or case — that's what caused duplicate uploads.
      const already = [...s.clientBlossoms, ...s.userBlossoms, ...s.customBlossoms]
        .some(b => b.url.trim().replace(/\/+$/, '').toLowerCase() === clean.toLowerCase())
      if (already) return s
      return { customBlossoms: [...s.customBlossoms, { ...server, url: clean }] }
    })
    get().saveToStorage()
  },
  removeCustomBlossom: (url) => {
    set(s => ({ customBlossoms: s.customBlossoms.filter(b => b.url !== url) }))
    get().saveToStorage()
  },
  setUserBlossoms: (servers) => { set({ userBlossoms: servers }); get().saveToStorage() },
  addUserBlossom: (server) => {
    if (get().userBlossoms.some(b => b.url === server.url)) return
    set(s => ({ userBlossoms: [...s.userBlossoms, server] }))
    get().saveToStorage()
  },
  removeUserBlossom: (url) => {
    set(s => ({ userBlossoms: s.userBlossoms.filter(b => b.url !== url) }))
    get().saveToStorage()
  },
  markUserBlossomsPublished: () => {
    set(s => ({ userBlossomsFound: true, userBlossomsBaseline: blossomListSignature(s.userBlossoms) }))
    get().saveToStorage()
  },

  // ─── User list loading ─────────────────────────────────────

  loadUserLists: async (pubkey) => {
    const relays = get().getAllEnabledRelayUrls('read')
    const [relayEv, blossomEv] = await Promise.all([
      fetchEvent(relays, { kinds: [KINDS.RELAY_LIST], authors: [pubkey] }).catch(() => null),
      fetchEvent(relays, { kinds: [KINDS.BLOSSOM_LIST], authors: [pubkey] }).catch(() => null),
    ])

    if (relayEv) {
      const parsed = parseRelayList(relayEv)
      // Preserve any local enabled toggles for relays already in our working copy.
      const prevEnabled = new Map(get().userRelays.map(r => [r.url, r.enabled]))
      const merged = parsed.map(r => ({ ...r, enabled: prevEnabled.get(r.url) ?? true }))
      set({ userRelays: merged, userRelaysFound: true, userRelaysBaseline: relayListSignature(parsed) })
    } else {
      // No list for this account — clear so the previous account's doesn't linger.
      set({ userRelays: [], userRelaysFound: false, userRelaysBaseline: relayListSignature([]) })
    }

    if (blossomEv) {
      const parsed = parseBlossomList(blossomEv)
      const prevEnabled = new Map(get().userBlossoms.map(b => [b.url, b.enabled]))
      const merged = parsed.map(b => ({ ...b, enabled: prevEnabled.get(b.url) ?? true }))
      set({ userBlossoms: merged, userBlossomsFound: true, userBlossomsBaseline: blossomListSignature(parsed) })
    } else {
      set({ userBlossoms: [], userBlossomsFound: false, userBlossomsBaseline: blossomListSignature([]) })
    }

    get().saveToStorage()
  },

  /** Clear the logged-in user's relay/blossom lists (on logout / account switch). */
  resetUserLists: () => {
    set({
      userRelays: [], userRelaysFound: false, userRelaysBaseline: relayListSignature([]),
      userBlossoms: [], userBlossomsFound: false, userBlossomsBaseline: blossomListSignature([]),
    })
    get().saveToStorage()
  },

  // ─── DNN Methods ───────────────────────────────────────────

  toggleDnnNode: (url, tier) => {
    if (tier === 'default') {
      set(s => ({ defaultDnnNodes: s.defaultDnnNodes.map(n => n.url === url ? { ...n, enabled: !n.enabled } : n) }))
    } else {
      set(s => ({ userDnnNodes: s.userDnnNodes.map(n => n.url === url ? { ...n, enabled: !n.enabled } : n) }))
    }
    get().saveToStorage()
  },
  addUserDnnNode: (node) => {
    set(s => ({ userDnnNodes: [...s.userDnnNodes, node] }))
    get().saveToStorage()
  },
  removeUserDnnNode: (url) => {
    set(s => ({ userDnnNodes: s.userDnnNodes.filter(n => n.url !== url) }))
    get().saveToStorage()
  },
  setDiscoveredDnnNodes: (nodes) => set({ discoveredDnnNodes: nodes }),

  // ─── PoW Methods ───────────────────────────────────────────

  setPostToClientRelays: (v) => { set({ postToClientRelays: v }); savePosting(get()) },
  setPostToUserRelays: (v) => { set({ postToUserRelays: v }); savePosting(get()) },
  setPostToCustomRelays: (v) => { set({ postToCustomRelays: v }); savePosting(get()) },
  setLimitRelaysPerList: (v) => { set({ limitRelaysPerList: v }); savePosting(get()) },
  setLimitBlossomsPerList: (v) => { set({ limitBlossomsPerList: v }); savePosting(get()) },
  setParallelBlossomUpload: (v) => { set({ parallelBlossomUpload: v }); savePosting(get()) },

  setPowDifficulty: (difficulty) => {
    set({ powDifficulty: difficulty })
    localStorage.setItem(StorageKey.POW_DIFFICULTY, difficulty.toString())
  },
  setPowFilterDifficulty: (difficulty) => {
    set({ powFilterDifficulty: difficulty })
    localStorage.setItem(StorageKey.POW_FILTER_DIFFICULTY, difficulty.toString())
  },
  setBlossomUploadLimitMb: (limit) => {
    set({ blossomUploadLimitMb: limit })
    localStorage.setItem(StorageKey.BLOSSOM_UPLOAD_LIMIT_MB, limit.toString())
  },
  setMediaDownloadLimitMb: (limit) => {
    set({ mediaDownloadLimitMb: limit })
    localStorage.setItem(StorageKey.MEDIA_DOWNLOAD_LIMIT_MB, limit.toString())
  },

  // ─── Computed Helpers ──────────────────────────────────────

  getAllEnabledRelayUrls: (mode = 'both') => {
    const s = get()
    // Publishing (write) honors the posting-behaviour toggles: which lists to
    // post to + an optional per-list cap. Reading is unaffected.
    if (mode === 'write') {
      const seen = new Set<string>()
      const out: string[] = []
      const addList = (list: RelayConfig[], include: boolean) => {
        if (!include) return
        let enabled = list.filter(r => r.enabled && r.write)
        if (s.limitRelaysPerList) enabled = pickRandom(enabled, 3)
        for (const r of enabled) if (!seen.has(r.url)) { seen.add(r.url); out.push(r.url) }
      }
      addList(s.clientRelays, s.postToClientRelays)
      addList(s.userRelays, s.postToUserRelays)
      addList(s.customRelays, s.postToCustomRelays)
      return out
    }

    const all = [...s.clientRelays, ...s.userRelays, ...s.customRelays]
    const seen = new Set<string>()
    return all.filter(r => {
      if (!r.enabled || seen.has(r.url)) return false
      seen.add(r.url)
      if (mode === 'read') return r.read
      return true
    }).map(r => r.url)
  },

  getAllEnabledBlossomUrls: () => {
    const s = get()
    const seen = new Set<string>()
    const out: string[] = []
    // Normalize (trim + drop trailing slashes) and dedupe case-insensitively, so
    // e.g. "https://brs.degmods.com" and "https://brs.degmods.com/" (or the same
    // host added twice across lists) can't cause a duplicate upload/fetch.
    const norm = (u: string) => u.trim().replace(/\/+$/, '')
    const addList = (list: BlossomConfig[]) => {
      let enabled = list.filter(b => b.enabled)
      if (s.limitBlossomsPerList) {
        // Pinned servers (the DEG Mods node) are always kept; the cap fills the
        // remaining slots from the rest at random.
        const pinned = enabled.filter(b => b.pinned)
        const rest = pickRandom(enabled.filter(b => !b.pinned), Math.max(0, 3 - pinned.length))
        enabled = [...pinned, ...rest]
      }
      for (const b of enabled) {
        const clean = norm(b.url)
        const key = clean.toLowerCase()
        if (clean && !seen.has(key)) { seen.add(key); out.push(clean) }
      }
    }
    addList(s.clientBlossoms)
    addList(s.userBlossoms)
    addList(s.customBlossoms)
    return out
  },

  // ─── Persistence ───────────────────────────────────────────

  loadFromStorage: () => {
    const userRelays = loadJson<RelayConfig[]>(StorageKey.USER_RELAYS, [])
    const userBlossoms = loadJson<BlossomConfig[]>(StorageKey.USER_BLOSSOMS, [])
    set({
      clientRelays: withNewDefaults(loadJson(StorageKey.CLIENT_RELAYS, DEFAULT_RELAYS), DEFAULT_RELAYS),
      customRelays: loadJson(StorageKey.CUSTOM_RELAYS, []),
      userRelays,
      userRelaysBaseline: relayListSignature(userRelays),
      clientBlossoms: withNewDefaults(loadJson(StorageKey.CLIENT_BLOSSOMS, DEFAULT_BLOSSOMS), DEFAULT_BLOSSOMS),
      customBlossoms: loadJson(StorageKey.CUSTOM_BLOSSOMS, []),
      userBlossoms,
      userBlossomsBaseline: blossomListSignature(userBlossoms),
      defaultDnnNodes: loadJson(StorageKey.DNN_NODES, DEFAULT_DNN_NODES),
      userDnnNodes: loadJson(StorageKey.USER_DNN_NODES, []),
      powDifficulty: parseInt(localStorage.getItem(StorageKey.POW_DIFFICULTY) ?? '15', 10),
      powFilterDifficulty: parseInt(localStorage.getItem(StorageKey.POW_FILTER_DIFFICULTY) ?? '15', 10),
      blossomUploadLimitMb: parseInt(localStorage.getItem(StorageKey.BLOSSOM_UPLOAD_LIMIT_MB) ?? '10', 10),
      mediaDownloadLimitMb: parseInt(localStorage.getItem(StorageKey.MEDIA_DOWNLOAD_LIMIT_MB) ?? '10', 10),
      ...loadJson<PostingBehaviour>(StorageKey.POSTING_BEHAVIOUR, POSTING_DEFAULTS),
    })
  },

  saveToStorage: () => {
    const s = get()
    localStorage.setItem(StorageKey.CLIENT_RELAYS, JSON.stringify(s.clientRelays))
    localStorage.setItem(StorageKey.CUSTOM_RELAYS, JSON.stringify(s.customRelays))
    localStorage.setItem(StorageKey.USER_RELAYS, JSON.stringify(s.userRelays))
    localStorage.setItem(StorageKey.CLIENT_BLOSSOMS, JSON.stringify(s.clientBlossoms))
    localStorage.setItem(StorageKey.CUSTOM_BLOSSOMS, JSON.stringify(s.customBlossoms))
    localStorage.setItem(StorageKey.USER_BLOSSOMS, JSON.stringify(s.userBlossoms))
    localStorage.setItem(StorageKey.DNN_NODES, JSON.stringify(s.defaultDnnNodes))
    localStorage.setItem(StorageKey.USER_DNN_NODES, JSON.stringify(s.userDnnNodes))
  },
}))
