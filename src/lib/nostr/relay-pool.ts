/**
 * Relay Pool: wraps nostr-tools SimplePool for DEG MODS
 */

import { SimplePool, type Filter, type Event as NostrEvent } from 'nostr-tools'

const pool = new SimplePool()

export function getPool(): SimplePool {
  return pool
}

/**
 * Fetch ALL events matching a filter, paginating each relay INDEPENDENTLY (a
 * cursor shared across relays skips a relay's middle date-range when another relay
 * returns a single older event) and stepping `until` backward past per-query caps
 * (relays like khatru clamp large `limit`s). Merges + dedupes by id.
 */
export async function fetchAllEvents(
  relayUrls: string[],
  filter: Filter,
  opts: { pageSize?: number; maxRounds?: number; timeoutMs?: number } = {},
): Promise<NostrEvent[]> {
  const { pageSize = 500, maxRounds = 40, timeoutMs = 10000 } = opts
  const byId = new Map<string, NostrEvent>()

  await Promise.all(
    relayUrls.map(async (relay) => {
      let until: number | undefined
      for (let round = 0; round < maxRounds; round++) {
        const batch = await fetchEvents(
          [relay],
          { ...filter, limit: pageSize, ...(until !== undefined ? { until } : {}) },
          timeoutMs,
        )
        if (batch.length === 0) break
        let min = Infinity
        for (const e of batch) {
          byId.set(e.id, e)
          if (e.created_at < min) min = e.created_at
        }
        if (min === Infinity || (until !== undefined && min >= until)) break
        until = min - 1
      }
    }),
  )
  return [...byId.values()]
}

/**
 * NIP-45 COUNT across relays — returns the highest count any relay reports (0 if
 * none support it). Just a number; no events are fetched. Filters can include tags
 * (e.g. `#t: ['GameMod']` for the legacy count).
 */
export async function countEvents(
  relayUrls: string[],
  filter: Filter,
  timeoutMs: number = 5000,
): Promise<number> {
  const results = await Promise.allSettled(
    relayUrls.map(async (url) => {
      const relay = await pool.ensureRelay(url, { connectionTimeout: 5000 })
      // relay.count() never resolves against a relay that doesn't support NIP-45
      // (it just never sends a COUNT reply), so bound each one — otherwise a single
      // silent relay leaves Promise.allSettled pending forever and we never read the
      // relays that DID answer (e.g. brs).
      return Promise.race([
        relay.count([filter], {}),
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error('count timeout')), timeoutMs),
        ),
      ])
    }),
  )
  let max = 0
  for (const r of results) {
    if (r.status === 'fulfilled' && Number.isFinite(r.value) && r.value > max) max = r.value
  }
  return max
}

export async function publishEvent(event: NostrEvent, relayUrls: string[]): Promise<void> {
  if (relayUrls.length === 0) throw new Error('No relays to publish to')

  // Reconnect any sockets dropped while the tab was backgrounded, so a publish
  // right after switching tabs doesn't fail with "not connected".
  const ensureConnections = async () => {
    await Promise.allSettled(
      relayUrls.map((url) =>
        Promise.resolve().then(() => pool.ensureRelay(url, { connectionTimeout: 5000 })),
      ),
    )
  }

  const tryPublish = async () => {
    const results = await Promise.allSettled(pool.publish(relayUrls, event))
    // Success requires at least one relay to have accepted the event.
    return results.some((r) => r.status === 'fulfilled')
  }

  await ensureConnections()
  let ok = await tryPublish()
  if (!ok) {
    // One retry after forcing a fresh reconnect.
    await ensureConnections()
    ok = await tryPublish()
  }
  if (!ok) throw new Error('Failed to publish to any relay')
}

/**
 * Publish an already-signed event to specific relays and return which ones
 * accepted it. Unlike `publishEvent` this never throws — it's best-effort — and
 * reports per-relay results, which is what cooperative rebroadcasting needs.
 * Re-publishing a signed event requires NO signer (the sig already exists), so
 * even anonymous visitors can help keep events alive.
 */
export async function publishToRelays(
  relayUrls: string[],
  event: NostrEvent,
  timeoutMs: number = 15000
): Promise<string[]> {
  if (relayUrls.length === 0) return []
  await Promise.allSettled(
    relayUrls.map((url) => Promise.resolve().then(() => pool.ensureRelay(url, { connectionTimeout: 5000 }))),
  )
  const results = await Promise.allSettled(
    pool.publish(relayUrls, event).map((p) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]),
    ),
  )
  const accepted: string[] = []
  results.forEach((r, i) => { if (r.status === 'fulfilled') accepted.push(relayUrls[i]) })
  return accepted
}

// ─── Read throttling ────────────────────────────────────────────────
//
// Relays cap how many subscriptions one connection may hold open, and answer
// past that with "subscription limit reached". The pool can't tell that refusal
// apart from a relay that genuinely has nothing, so a read fired during a burst
// silently returns empty — most visibly at startup, when the feed, profile,
// notification, DM and redundancy reads all begin at once.
//
// Two guards, both here rather than at the ~100 call sites:
//   1. a ceiling on concurrent one-shot reads, with the rest queued;
//   2. de-duplication, so identical concurrent reads share one subscription.
//
// Long-lived subscribe() calls are left alone — they hold their slot for the
// session either way, and queueing them would just delay the inbox.

const MAX_CONCURRENT_READS = 6
let activeReads = 0
const readQueue: (() => void)[] = []

function acquireRead(): Promise<void> {
  if (activeReads < MAX_CONCURRENT_READS) {
    activeReads++
    return Promise.resolve()
  }
  return new Promise((resolve) => readQueue.push(() => { activeReads++; resolve() }))
}

function releaseRead(): void {
  activeReads--
  readQueue.shift()?.()
}

/** In-flight reads keyed by relays+filter, so duplicates share one round trip. */
const inFlight = new Map<string, Promise<NostrEvent[]>>()

function readKey(relayUrls: string[], filter: Filter, extra = ''): string {
  return JSON.stringify([[...relayUrls].sort(), filter, extra])
}

export async function fetchEvents(
  relayUrls: string[],
  filter: Filter,
  timeoutMs: number = 8000,
  maxWait?: number
): Promise<NostrEvent[]> {
  if (relayUrls.length === 0) return []

  const key = readKey(relayUrls, filter, `events:${timeoutMs}:${maxWait ?? ''}`)
  const existing = inFlight.get(key)
  if (existing) return existing

  const run = (async () => {
    await acquireRead()
    try {
      return await fetchEventsUnthrottled(relayUrls, filter, timeoutMs, maxWait)
    } finally {
      releaseRead()
    }
  })()

  inFlight.set(key, run)
  run.finally(() => { if (inFlight.get(key) === run) inFlight.delete(key) })
  return run
}

function fetchEventsUnthrottled(
  relayUrls: string[],
  filter: Filter,
  timeoutMs: number,
  maxWait?: number
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = []
    const timeout = setTimeout(() => {
      sub.close()
      resolve(events)
    }, timeoutMs)

    const sub = pool.subscribeMany(relayUrls, filter, {
      // maxWait gives relays that never EOSE (some search relays) a deadline to
      // auto-close, so oneose can fire instead of always waiting out timeoutMs.
      ...(maxWait ? { maxWait } : {}),
      onevent: (event: NostrEvent) => {
        events.push(event)
      },
      oneose: () => {
        clearTimeout(timeout)
        sub.close()
        resolve(events)
      },
    })
  })
}

/**
 * Fetch a single event across relays and return the NEWEST one by `created_at`.
 *
 * Almost every use of this is an addressable/replaceable event (a mod, blog,
 * profile, contact list, relay list, admin config doc, …). Different relays can
 * hold different revisions of the same coordinate, so resolving on the first
 * relay to answer would happily return a stale copy. Instead we collect from all
 * relays (one event each via `limit: 1`) and keep the highest `created_at`.
 *
 * Latency is bounded: we resolve as soon as every relay has sent EOSE, and
 * `maxWait` makes relays that never EOSE (e.g. some search relays) auto-close so
 * one dead relay can't stall the whole fetch. `timeoutMs` is the hard ceiling.
 * For fetch-by-id this is equivalent to before (there's only one revision).
 */
export async function fetchEvent(
  relayUrls: string[],
  filter: Filter,
  timeoutMs: number = 5000
): Promise<NostrEvent | null> {
  if (relayUrls.length === 0) return null

  // Throttled and de-duplicated alongside fetchEvents — see the note there.
  const key = readKey(relayUrls, filter, `event:${timeoutMs}`)
  const existing = inFlight.get(key)
  if (existing) return existing.then((evs) => evs[0] ?? null)

  const run = (async () => {
    await acquireRead()
    try {
      const ev = await fetchEventUnthrottled(relayUrls, filter, timeoutMs)
      return ev ? [ev] : []
    } finally {
      releaseRead()
    }
  })()

  inFlight.set(key, run)
  run.finally(() => { if (inFlight.get(key) === run) inFlight.delete(key) })
  return run.then((evs) => evs[0] ?? null)
}

function fetchEventUnthrottled(
  relayUrls: string[],
  filter: Filter,
  timeoutMs: number
): Promise<NostrEvent | null> {
  return new Promise((resolve) => {
    let best: NostrEvent | null = null
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try { sub.close() } catch { /* already closed */ }
      resolve(best)
    }
    const timeout = setTimeout(finish, timeoutMs)

    const sub = pool.subscribeMany(relayUrls, { ...filter, limit: 1 }, {
      maxWait: Math.min(timeoutMs, 3000),
      onevent: (event: NostrEvent) => {
        if (!best || event.created_at > best.created_at) best = event
      },
      // Fires once every relay has EOSE'd (real or via maxWait auto-close).
      oneose: finish,
    })
  })
}

/**
 * High-assurance fetch of the NEWEST revision of an addressable/replaceable
 * event. Like `fetchEvent`, but makes several passes and keeps the highest
 * `created_at` seen across all of them.
 *
 * Why passes: a fast relay can serve a STALE revision while the relay holding
 * the current one is slow to connect on a cold start — a single pass would
 * settle on the stale copy. The nostr pool reuses connections, so a relay missed
 * on pass 1 is almost always caught on pass 2. We stop as soon as two passes
 * agree on the newest id (so warm callers pay for only ~2 passes).
 *
 * This costs more wall-clock than `fetchEvent`, so use it where correctness
 * matters and latency is hidden — background refreshes / cache-first views — not
 * on hot interactive paths.
 */
export async function fetchLatestEvent(
  relayUrls: string[],
  filter: Filter,
  opts: { passes?: number; timeoutMs?: number; maxWait?: number; gapMs?: number } = {}
): Promise<NostrEvent | null> {
  const { passes = 3, timeoutMs = 8000, maxWait = 4500, gapMs = 1500 } = opts
  if (relayUrls.length === 0) return null

  const byId = new Map<string, NostrEvent>()
  const newest = (): NostrEvent | null => {
    let best: NostrEvent | null = null
    for (const e of byId.values()) if (!best || e.created_at > best.created_at) best = e
    return best
  }

  let result: NostrEvent | null = null
  let prevId: string | null = null
  for (let i = 0; i < passes; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs))
    const evs = await fetchEvents(relayUrls, { ...filter, limit: 1 }, timeoutMs, maxWait)
    for (const e of evs) byId.set(e.id, e)
    result = newest()
    if (result && result.id === prevId) break // newest is stable across passes
    prevId = result?.id ?? null
  }
  return result
}

export function subscribe(
  relayUrls: string[],
  filter: Filter,
  onEvent: (event: NostrEvent) => void,
  onEose?: () => void,
) {
  if (relayUrls.length === 0) return { close: () => {} }

  return pool.subscribeMany(relayUrls, filter, {
    onevent: onEvent,
    oneose: onEose,
  })
}
