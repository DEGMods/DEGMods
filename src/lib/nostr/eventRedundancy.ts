/**
 * eventRedundancy — cooperative event rebroadcasting
 *
 * Relays occasionally purge events. This is a counter-measure: any visitor
 * (logged in or not) helps keep important events alive by checking how widely
 * the *latest* revision is replicated and re-publishing it to relays that are
 * missing it — or serving a stale revision. Re-publishing an already-signed
 * event needs NO signer, so anonymous users participate too.
 *
 * Policy: an event is safe once its latest revision is present on at least
 * MIN_REDUNDANCY relays. Below that we rebroadcast the latest to relays that
 * lack it. Presence is checked across all enabled relays, but we only *write* to
 * relays the user marked writable (respecting their read/write config). If that
 * still can't reach the threshold "with what it has", we fall back to the
 * author's own relay list (NIP-65) as extra sources/targets and try once more.
 *
 * Two entry points:
 *   - ensureEventRedundancy(kind, pubkey, dTag?) — we don't hold the event, so
 *     query relays to find the latest, then rebroadcast. Used for admin config.
 *   - ensureEventPresent(event) — we already have the (latest) signed event
 *     because we're viewing it. Used per mod / blog post opened.
 *
 * Checks are deduped per session and processed through a sequential queue so we
 * never flood relays.
 */

import type { Event as NostrEvent, Filter } from 'nostr-tools'
import { fetchEvent, fetchEvents, publishToRelays } from './relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { KINDS, ADMIN_PUBKEY } from '@/lib/constants'

/** The latest revision is "safe" once it lives on at least this many relays. */
const MIN_REDUNDANCY = 3
const PER_RELAY_TIMEOUT = 6000

/** Admin NIP-78 (kind 30078) config docs — kept alive cooperatively by everyone. */
const ADMIN_CONFIG_DTAGS = [
  'games-db',
  'site-ads',
  'site-announcement',
  'site-faq',
  'terms-of-use',
  'site-guides',
  'blocked-mods',
  'emulated-platforms',
  'moderation-excluded-tags',
  'suggested-categories',
  'suggested-tags',
  'home-featured-mods-slider',
  'home-featured-mods',
  'home-featured-games',
  'featured-mod-banner',
]

// ── Session dedup + sequential queue ──
const checkedThisSession = new Set<string>()
const queue: Array<() => Promise<void>> = []
let processing = false

function enqueue(task: () => Promise<void>) {
  queue.push(task)
  if (processing) return
  processing = true
  void (async () => {
    while (queue.length) {
      const task = queue.shift()!
      try { await task() } catch (err) { console.warn('[EventRedundancy] task failed:', err) }
    }
    processing = false
  })()
}

const norm = (u: string) => u.replace(/\/+$/, '')
function keyOf(kind: number, pubkey: string, dTag?: string) {
  return dTag !== undefined ? `${kind}:${pubkey}:${dTag}` : `${kind}:${pubkey}`
}

/** Enabled relays by flag, straight from settings (no posting-behaviour gating). */
function relaySet(flag: 'read' | 'write'): string[] {
  const s = useSettingsStore.getState()
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of [s.clientRelays, s.userRelays, s.customRelays]) {
    for (const r of list) {
      if (!r.enabled || !r[flag]) continue
      const n = norm(r.url)
      if (!seen.has(n)) { seen.add(n); out.push(r.url) }
    }
  }
  return out
}

/** Query a single relay for the latest event matching the filter (or null). */
async function queryOne(relay: string, filter: Filter): Promise<NostrEvent | null> {
  try {
    const evs = await fetchEvents([relay], { ...filter, limit: 1 }, PER_RELAY_TIMEOUT)
    return evs.sort((a, b) => b.created_at - a.created_at)[0] ?? null
  } catch {
    return null
  }
}

/** The author's NIP-65 relays: all of them (sources) + the writable subset (targets). */
async function authorRelays(pubkey: string, from: string[]): Promise<{ all: string[]; write: string[] }> {
  const ev = await fetchEvent(from, { kinds: [KINDS.RELAY_LIST], authors: [pubkey] }, 6000)
  const all: string[] = []
  const write: string[] = []
  for (const t of ev?.tags ?? []) {
    if (t[0] !== 'r' || !t[1]) continue
    all.push(t[1])
    if (!t[2] || t[2] === 'write') write.push(t[1]) // unmarked = read+write
  }
  return { all, write }
}

/**
 * One coverage pass over `checkRelays`: find the latest revision, and if it's on
 * fewer than MIN_REDUNDANCY relays, rebroadcast it to the writable relays that
 * lack it. Returns the latest revision seen and how many relays now hold it.
 */
async function coveragePass(
  filter: Filter,
  have: NostrEvent | null,
  checkRelays: string[],
  writable: Set<string>,
): Promise<{ latest: NostrEvent | null; coverage: number }> {
  const found = await Promise.all(checkRelays.map((r) => queryOne(r, filter)))

  let latest = have
  for (const ev of found) if (ev && (!latest || ev.created_at > latest.created_at)) latest = ev
  if (!latest) return { latest: null, coverage: 0 }

  const lackingWritable: string[] = []
  let coverage = 0
  checkRelays.forEach((r, i) => {
    const ev = found[i]
    if (ev && ev.id === latest!.id) coverage++
    else if (writable.has(norm(r))) lackingWritable.push(r)
  })
  if (coverage >= MIN_REDUNDANCY || lackingWritable.length === 0) return { latest, coverage }

  const accepted = await publishToRelays(lackingWritable, latest)
  return { latest, coverage: coverage + accepted.length }
}

/**
 * Core: ensure the latest revision is on ≥ MIN_REDUNDANCY relays. Tries the
 * user's relays first; only if that can't reach the threshold does it pull the
 * author's NIP-65 relays and try again.
 */
async function checkAndRebroadcast(filter: Filter, key: string, author: string, have?: NostrEvent): Promise<void> {
  const checkRelays = useSettingsStore.getState().getAllEnabledRelayUrls('both')
  if (checkRelays.length === 0) return
  const writable = new Set(relaySet('write').map(norm))

  let { latest, coverage } = await coveragePass(filter, have ?? null, checkRelays, writable)

  // Fallback: couldn't reach the threshold with our own relays — widen to the
  // author's published relays (both as sources to find a copy and as targets).
  if (coverage < MIN_REDUNDANCY) {
    const extra = await authorRelays(author, checkRelays)
    const known = new Set(checkRelays.map(norm))
    const newCheck = extra.all.filter((r) => !known.has(norm(r)))
    if (newCheck.length) {
      const expandedCheck = [...checkRelays, ...newCheck]
      const expandedWrite = new Set([...writable, ...extra.write.map(norm)])
      ;({ latest, coverage } = await coveragePass(filter, latest ?? have ?? null, expandedCheck, expandedWrite))
    }
  }

  console.log(`[EventRedundancy] ${key}: latest revision on ${coverage} relay(s)` +
    (latest ? '' : ' (not found anywhere)'))
}

// ── Public API ──

/** Ensure an addressable event (we don't hold) is replicated. Deduped per session. */
export function ensureEventRedundancy(kind: number, pubkey: string, dTag?: string) {
  const key = keyOf(kind, pubkey, dTag)
  if (checkedThisSession.has(key)) return
  checkedThisSession.add(key)
  const filter: Filter = { kinds: [kind], authors: [pubkey] }
  if (dTag !== undefined) filter['#d'] = [dTag]
  enqueue(() => checkAndRebroadcast(filter, key, pubkey, undefined))
}

/** Ensure a specific event we already hold (e.g. the mod/blog being viewed) is replicated. */
export function ensureEventPresent(event: NostrEvent) {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
  const key = keyOf(event.kind, event.pubkey, dTag)
  if (checkedThisSession.has(key)) return
  checkedThisSession.add(key)
  const filter: Filter = { kinds: [event.kind], authors: [event.pubkey] }
  if (dTag !== undefined) filter['#d'] = [dTag]
  enqueue(() => checkAndRebroadcast(filter, key, event.pubkey, event))
}

/**
 * Keep the admin's important events alive — called by every visitor on startup.
 * Covers the NIP-78 config docs plus the admin mute list.
 */
export function ensureAdminEventsRedundancy() {
  for (const dTag of ADMIN_CONFIG_DTAGS) {
    ensureEventRedundancy(KINDS.GAME_DB, ADMIN_PUBKEY, dTag)
  }
  ensureEventRedundancy(KINDS.MUTE_LIST, ADMIN_PUBKEY)
}
