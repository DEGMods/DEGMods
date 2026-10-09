/**
 * Endpoint health store (shared core for relays + Blossom servers).
 *
 * A reachability check (socket connects / HEAD returns) is NOT enough: the
 * failure that actually breaks publishing is an endpoint that ANSWERS but
 * rejects writes or won't serve what it just took (a relay that silently drops
 * events; a Blossom server that 415/401/CORS-rejects an upload). So each probe
 * does a WRITE + READ-BACK round-trip and labels the endpoint `working` /
 * `broken`. The probe itself is supplied by the caller (relay vs Blossom differ);
 * this module owns the caching, TTL, multi-pass debouncing and persistence that
 * are identical for both.
 *
 * Status is persisted to localStorage with a `checkedAt` timestamp:
 *   - fresh (< ttlMs, default 24h)  → reused, no re-probe.
 *   - stale (ttlMs‥dropMs)          → shown instantly, re-probed in the BACKGROUND
 *                                      keeping the last label (no 'checking' flash).
 *   - expired (> dropMs, default 7d) → dropped on load, re-checked fresh.
 *
 * Multi-pass guards against a transient blip flipping a good endpoint to broken:
 * any single passing probe → `working`; `broken` only after every pass in a
 * check fails, and a currently-`working` endpoint gets more passes (3 vs 2)
 * before it can be demoted.
 */
import { create } from 'zustand'

export type HealthStatus = 'checking' | 'working' | 'broken'

/** Persisted per-URL result. Transient 'checking' is never stored. */
interface HealthEntry {
  status: 'working' | 'broken'
  checkedAt: number
}

export interface HealthStore {
  /** Last settled result per URL (persisted). */
  health: Record<string, HealthEntry>
  /** Live pass progress for URLs being probed in the FOREGROUND (not persisted). */
  progress: Record<string, { pass: number; total: number }>
  /** Probe any of `urls` that are unknown or stale (unknown → shows 'checking'; stale → background). */
  refresh: (urls: string[]) => Promise<void>
  /** Force-reprobe ONE url now, showing 'checking' + pass progress. */
  recheck: (url: string) => Promise<void>
  /** Force-reprobe ALL `urls` now, sharing one probe sweep (one event / one signature). */
  refreshAll: (urls: string[]) => Promise<void>
  /** 'checking' while a foreground probe runs, else the last settled status (or undefined = untested). */
  statusOf: (url: string) => HealthStatus | undefined
  /** Stable sort: working first, untested second, broken last (base order kept within a tier). */
  orderByHealth: (urls: string[]) => string[]
}

export interface HealthConfig<Ctx> {
  /** localStorage key for the persisted `health` map. */
  lsKey: string
  /** Reuse a cached result younger than this (ms). Default 24h. */
  ttlMs?: number
  /** Drop a persisted result older than this on load (ms). Default 7d. */
  dropMs?: number
  /**
   * Open a probe sweep ONCE and return a shared context reused across every
   * endpoint in that sweep (e.g. resolve one already-public event to re-publish,
   * or sign one Blossom auth). Return null when probing isn't possible right now
   * (e.g. logged out, or no probe event resolvable) — the sweep is skipped.
   */
  openSweep: () => Promise<Ctx | null>
  /** Probe one endpoint once with the sweep context. Resolve true on a passing write + read-back. */
  probeOnce: (url: string, ctx: Ctx) => Promise<boolean>
}

const DAY = 24 * 60 * 60 * 1000

export function createHealthStore<Ctx>(cfg: HealthConfig<Ctx>) {
  const ttlMs = cfg.ttlMs ?? DAY
  const dropMs = cfg.dropMs ?? 7 * DAY

  function load(): Record<string, HealthEntry> {
    try {
      const raw = localStorage.getItem(cfg.lsKey)
      const parsed = (raw ? JSON.parse(raw) : {}) as Record<string, HealthEntry>
      const now = Date.now()
      const kept: Record<string, HealthEntry> = {}
      for (const [u, e] of Object.entries(parsed)) {
        // Keep only well-formed, not-yet-expired results; expired ones re-check fresh.
        if (e && (e.status === 'working' || e.status === 'broken') && now - e.checkedAt <= dropMs) {
          kept[u] = e
        }
      }
      return kept
    } catch {
      return {}
    }
  }

  function save(h: Record<string, HealthEntry>) {
    try { localStorage.setItem(cfg.lsKey, JSON.stringify(h)) } catch { /* quota/serialize — non-fatal */ }
  }

  // One probe per URL at a time: N rows mounting their badges must not fire N
  // duplicate probes, and refresh + a click must not race on the same URL.
  const inFlight = new Set<string>()

  return create<HealthStore>((set, get) => {
    const setProgress = (url: string, p: { pass: number; total: number } | null) => {
      set((s) => {
        const progress = { ...s.progress }
        if (p) progress[url] = p
        else delete progress[url]
        return { progress }
      })
    }

    const settle = (url: string, status: 'working' | 'broken') => {
      const next = { ...get().health, [url]: { status, checkedAt: Date.now() } }
      set({ health: next })
      save(next)
    }

    /**
     * One check = up to `total` probe passes. Any pass that passes settles
     * 'working' immediately; only if every pass fails do we settle 'broken'. A
     * currently-'working' endpoint gets 3 passes before it can be demoted (so one
     * flaky pass can't flip it); anything else needs 2.
     */
    const runCheck = async (url: string, ctx: Ctx, foreground: boolean) => {
      if (inFlight.has(url)) return
      inFlight.add(url)
      const total = get().health[url]?.status === 'working' ? 3 : 2
      try {
        for (let pass = 1; pass <= total; pass++) {
          if (foreground) setProgress(url, { pass, total })
          let ok = false
          try { ok = await cfg.probeOnce(url, ctx) } catch { ok = false }
          if (ok) { settle(url, 'working'); return }
        }
        settle(url, 'broken')
      } finally {
        inFlight.delete(url)
        if (foreground) setProgress(url, null)
      }
    }

    return {
      health: load(),
      progress: {},

      statusOf: (url) => (get().progress[url] ? 'checking' : get().health[url]?.status),

      orderByHealth: (urls) => {
        const rank = (u: string) => {
          const st = get().health[u]?.status
          return st === 'working' ? 0 : st === 'broken' ? 2 : 1
        }
        // Decorate-sort-undecorate for a STABLE sort: equal ranks keep base order,
        // so the configured list ordering is preserved within each tier.
        return urls
          .map((u, i) => [u, i] as const)
          .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
          .map(([u]) => u)
      },

      refresh: async (urls) => {
        const now = Date.now()
        const health = get().health
        const todo = [...new Set(urls)].filter((u) => {
          if (inFlight.has(u)) return false
          const e = health[u]
          return !e || now - e.checkedAt > ttlMs
        })
        if (todo.length === 0) return
        const ctx = await cfg.openSweep()
        if (ctx === null) return
        // Unknown URLs show 'checking' (first-ever probe); stale-but-labelled URLs
        // re-probe silently so a routine re-check doesn't flash away the label.
        await Promise.all(todo.map((u) => runCheck(u, ctx, !health[u])))
      },

      recheck: async (url) => {
        if (inFlight.has(url)) return
        const ctx = await cfg.openSweep()
        if (ctx === null) return
        await runCheck(url, ctx, true)
      },

      refreshAll: async (urls) => {
        const ctx = await cfg.openSweep()
        if (ctx === null) return
        await Promise.all([...new Set(urls)].filter((u) => !inFlight.has(u)).map((u) => runCheck(u, ctx, true)))
      },
    }
  })
}
