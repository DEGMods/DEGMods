import { create } from 'zustand'
import { DEFAULT_RELAYS } from '@/lib/constants'
import { fetchRelaySupportedNips } from '@/lib/nostr/relayInfo'

/**
 * Caches each relay's NIP-11 `supported_nips` locally so we know which relays
 * support NIP-50 search. Probed proactively on startup and whenever the relay
 * set changes; search reads this cache rather than probing inline.
 *
 * Relays the app ships pre-marked as search-capable (the `search` flag in the
 * default relay list) are always treated as supporting search — those defaults
 * are visible/manageable in Settings, so there are no hidden hardcoded relays.
 */

const LS_KEY = 'deg-mods:relay-capabilities'
const TTL_MS = 7 * 24 * 60 * 60 * 1000 // re-probe weekly

// Pre-marked search hosts, derived from the default relay list's `search` flag.
const SEARCH_HOSTS = new Set(
  DEFAULT_RELAYS.filter(r => r.search).map(r => hostOf(r.url)).filter(Boolean),
)

function hostOf(url: string): string {
  try { return new URL(url).host.toLowerCase() } catch { return '' }
}

/** Whether a relay is pre-marked (by host) as NIP-50 search capable. */
export function isKnownSearchRelay(url: string): boolean {
  return SEARCH_HOSTS.has(hostOf(url))
}

interface RelayCap {
  supportedNips: number[]
  checkedAt: number
}

interface RelayCapabilityState {
  capabilities: Record<string, RelayCap>
  /** Probe (NIP-11) any of `urls` that are unknown or stale. */
  probeRelays: (urls: string[]) => Promise<void>
  /** Whether a relay supports NIP-50 search (pre-marked or NIP-11 advertised). */
  supportsNip50: (url: string) => boolean
  /** Of `urls`, the ones that support NIP-50 vs the rest. */
  splitBySearch: (urls: string[]) => { search: string[]; other: string[] }
}

function load(): Record<string, RelayCap> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function save(caps: Record<string, RelayCap>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(caps)) } catch { /* ignore */ }
}

export const useRelayCapabilityStore = create<RelayCapabilityState>((set, get) => ({
  capabilities: load(),

  probeRelays: async (urls) => {
    const now = Date.now()
    const caps = get().capabilities
    const todo = [...new Set(urls)].filter((u) => {
      const c = caps[u]
      return !c || now - c.checkedAt > TTL_MS
    })
    if (todo.length === 0) return

    const results = await Promise.all(
      todo.map(async (u) => [u, await fetchRelaySupportedNips(u)] as const),
    )
    const next = { ...get().capabilities }
    for (const [u, nips] of results) {
      // null (unreachable / no CORS) → no NIP-11 signal, but record the
      // timestamp so we don't hammer it before the TTL.
      next[u] = { supportedNips: nips ?? [], checkedAt: now }
    }
    set({ capabilities: next })
    save(next)
  },

  supportsNip50: (url) => {
    if (isKnownSearchRelay(url)) return true
    return (get().capabilities[url]?.supportedNips ?? []).includes(50)
  },

  splitBySearch: (urls) => {
    const supports = get().supportsNip50
    const search: string[] = []
    const other: string[] = []
    for (const u of urls) (supports(u) ? search : other).push(u)
    return { search, other }
  },
}))
