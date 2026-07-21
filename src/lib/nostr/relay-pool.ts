/**
 * Relay Pool: wraps nostr-tools SimplePool for DEG MODS
 */

import { SimplePool, matchFilter, type Filter, type Event as NostrEvent } from 'nostr-tools'

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

// ─── Subscription pooling ───────────────────────────────────────────
//
// De-duplication (above) only helps when two callers want the *same* thing. The
// commoner case is many callers wanting different things at once — a listing,
// the profiles for its authors, the moderation overlays, the reaction counts —
// each of which used to open its own REQ. That is what exhausts a relay's
// subscription limit.
//
// A REQ can carry several filters, so reads aimed at the same relay set within a
// short window are collected and sent as ONE subscription per relay. Events come
// back on that single subscription and are handed to whichever callers' filters
// actually match, so nobody sees anything they didn't ask for.
//
// The read slot is taken by the *batch*, not the caller: a slot stands for a
// subscription, and a batch is one subscription per relay however many filters
// it carries. Otherwise the concurrency cap would throttle the very thing that
// makes batching worthwhile.

/** How long to gather reads before sending them as one subscription. */
const BATCH_WINDOW_MS = 25
/**
 * Filters per REQ. Relays commonly cap this (NIP-11 `max_filters`, often 10) and
 * a refused REQ would fail the whole batch, so this stays well under the usual
 * limit rather than chasing the largest possible saving.
 */
const MAX_FILTERS_PER_REQ = 8

interface BatchRequest {
  filter: Filter
  timeoutMs: number
  maxWait?: number
  events: NostrEvent[]
  seen: Set<string>
  settled: boolean
  timer?: ReturnType<typeof setTimeout>
  resolve: (events: NostrEvent[]) => void
}

interface Batch {
  relayUrls: string[]
  requests: BatchRequest[]
  timer: ReturnType<typeof setTimeout>
}

const batches = new Map<string, Batch>()

/** Queue a read; it leaves as part of the next batch for this relay set. */
function enqueueRead(
  relayUrls: string[],
  filter: Filter,
  timeoutMs: number,
  maxWait?: number,
): Promise<NostrEvent[]> {
  const key = JSON.stringify([...relayUrls].sort())
  return new Promise((resolve) => {
    const request: BatchRequest = {
      filter, timeoutMs, maxWait, events: [], seen: new Set(), settled: false, resolve,
    }
    let batch = batches.get(key)
    if (!batch) {
      batch = {
        relayUrls,
        requests: [],
        timer: setTimeout(() => flushBatch(key), BATCH_WINDOW_MS),
      }
      batches.set(key, batch)
    }
    batch.requests.push(request)
    // Send early once it's as full as a REQ should get.
    if (batch.requests.length >= MAX_FILTERS_PER_REQ) flushBatch(key)
  })
}

function flushBatch(key: string): void {
  const batch = batches.get(key)
  if (!batch) return
  batches.delete(key)
  clearTimeout(batch.timer)
  void runBatch(batch)
}

async function runBatch(batch: Batch): Promise<void> {
  await acquireRead()
  try {
    // A batch of one is the old path exactly — no reason to take the merged
    // route for it, and it keeps the common case on well-travelled code.
    if (batch.requests.length === 1) {
      const req = batch.requests[0]
      const events = await fetchEventsUnthrottled(batch.relayUrls, req.filter, req.timeoutMs, req.maxWait)
      if (!req.settled) { req.settled = true; req.resolve(events) }
      return
    }
    await runMergedBatch(batch)
  } finally {
    releaseRead()
  }
}

/**
 * One REQ per relay carrying every filter in the batch.
 *
 * Falls back to running the reads separately if no relay managed an EOSE — a
 * relay that refuses a multi-filter REQ closes the subscription instead, and
 * that must not turn into "everyone got zero results", which is precisely the
 * silent-empty failure this file exists to prevent.
 */
function runMergedBatch(batch: Batch): Promise<void> {
  return new Promise((done) => {
    const filters = batch.requests.map((r) => r.filter)
    const subs: Array<{ close: () => void }> = []
    let pending = batch.requests.length
    let relaysLeft = batch.relayUrls.length
    let anyEose = false
    let finished = false

    const cleanup = () => {
      if (finished) return
      finished = true
      for (const s of subs) { try { s.close() } catch { /* already closed */ } }
      done()
    }

    const settle = (req: BatchRequest) => {
      if (req.settled) return
      req.settled = true
      clearTimeout(req.timer)
      req.resolve(req.events)
      if (--pending === 0) cleanup()
    }

    const settleAll = () => { for (const r of batch.requests) settle(r) }

    // A relay is "done" on EOSE, on close, or on failing to connect. Counted
    // once each way — oneose and onclose can both fire for the same relay.
    const relayDone = (eose: boolean) => {
      if (eose) anyEose = true
      if (--relaysLeft > 0) return
      if (anyEose) { settleAll(); return }
      // Nobody EOSE'd: assume the merged REQ was refused and retry separately.
      cleanup()
      void Promise.all(batch.requests.map(async (req) => {
        if (req.settled) return
        const events = await fetchEventsUnthrottled(batch.relayUrls, req.filter, req.timeoutMs, req.maxWait)
        if (!req.settled) { req.settled = true; req.resolve(events) }
      })).then(() => done())
    }

    for (const req of batch.requests) {
      // maxWait is a deadline for relays that never EOSE; as a settle deadline it
      // behaves the same, since an early all-relays-EOSE settles sooner anyway.
      const deadline = Math.min(req.timeoutMs, req.maxWait ?? req.timeoutMs)
      req.timer = setTimeout(() => settle(req), deadline)
    }

    for (const url of batch.relayUrls) {
      let counted = false
      const once = (eose: boolean) => { if (!counted) { counted = true; relayDone(eose) } }
      pool.ensureRelay(url, { connectionTimeout: 5000 }).then((relay) => {
        const sub = relay.subscribe(filters, {
          onevent: (event: NostrEvent) => {
            for (const req of batch.requests) {
              if (req.settled || req.seen.has(event.id)) continue
              if (matchFilter(req.filter, event)) {
                req.seen.add(event.id)
                req.events.push(event)
              }
            }
          },
          oneose: () => once(true),
          onclose: () => once(false),
        })
        subs.push(sub)
      }).catch(() => once(false))
    }
  })
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

  // The read slot is taken by the batch this joins, not here.
  const run = enqueueRead(relayUrls, filter, timeoutMs, maxWait)

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

  // Batched alongside fetchEvents: `limit: 1` keeps each relay to one event per
  // filter, and the newest-wins reduce below is what made this its own function.
  const run = enqueueRead(
    relayUrls,
    { ...filter, limit: 1 },
    timeoutMs,
    Math.min(timeoutMs, 3000),
  ).then((evs) => {
    let best: NostrEvent | null = null
    for (const ev of evs) if (!best || ev.created_at > best.created_at) best = ev
    return best ? [best] : []
  })

  inFlight.set(key, run)
  run.finally(() => { if (inFlight.get(key) === run) inFlight.delete(key) })
  return run.then((evs) => evs[0] ?? null)
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
