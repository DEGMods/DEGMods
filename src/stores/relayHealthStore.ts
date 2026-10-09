/**
 * Relay health — probe each relay on the roles it's actually configured for.
 *   - read:  a raw socket opens and the relay answers a REQ (any EVENT/EOSE/NOTICE/
 *            CLOSED reply = reachable and speaking Nostr). CLOSED counts too — a
 *            scoped relay like brs rejects an off-scope filter but is clearly up.
 *   - write: re-publish one already-signed event and read it straight back by id.
 *
 * A read+write relay runs BOTH and is 'broken' only when both fail (a relay that
 * still serves reads isn't dead). A read-only relay (write:false, e.g. a NIP-50
 * search indexer) is judged on READ alone — write-probing it would always read
 * broken since it rejects writes by design.
 *
 * The write probe reuses the user's OWN most-recent MOD event for the sweep: a
 * mod (kind 31142) is an accepted kind on DEG Mods' scoped relays (a plain note
 * is rejected outright there, which would falsely read as broken) and it already
 * carries PoW, so the write actually exercises the relay's accept path. Falls back
 * to any authored event, then any public note, for general relays. Re-publishing a
 * public event needs no signer; nothing new is ever signed.
 */
import type { Event as NostrEvent } from 'nostr-tools'
import { createHealthStore } from '@/lib/health/healthStore'
import { fetchEvents, publishToRelays } from '@/lib/nostr/relay-pool'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { KINDS } from '@/lib/constants'

// Short per-op deadline so a hanging relay is flagged fast, not after the normal
// 15s publish timeout.
const OP_TIMEOUT = 5000
// Relays routinely EOSE a query before a just-published event is indexed, so read
// back with increasing patience before concluding the write didn't take.
const READBACK_WAITS = [500, 1200, 1900]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A relay's configured roles, looked up across the three tiers (default: both). */
function relayRole(url: string): { read: boolean; write: boolean } {
  const s = useSettingsStore.getState()
  for (const list of [s.clientRelays, s.userRelays, s.customRelays]) {
    const r = list.find((x) => x.url === url)
    if (r) return { read: r.read, write: r.write }
  }
  return { read: true, write: true }
}

/**
 * Resolve one event to write-probe every relay with this sweep. Prefer the user's
 * own recent MOD (accepted on scoped relays + carries PoW), then any authored
 * event, then any public note. May be null (logged out, nothing fetched) — then
 * only the write half is skipped; read probes still run.
 */
async function resolveProbeEvent(): Promise<NostrEvent | null> {
  const read = useSettingsStore.getState().getAllEnabledRelayUrls('read')
  if (read.length === 0) return null
  const pubkey = useAuthStore.getState().pubkey
  if (pubkey) {
    const myMod = await fetchEvents(read, { authors: [pubkey], kinds: [KINDS.MOD], limit: 1 }, OP_TIMEOUT).catch(() => [])
    if (myMod[0]) return myMod[0]
    const mine = await fetchEvents(read, { authors: [pubkey], limit: 1 }, OP_TIMEOUT).catch(() => [])
    if (mine[0]) return mine[0]
  }
  const any = await fetchEvents(read, { kinds: [1], limit: 1 }, OP_TIMEOUT).catch(() => [])
  return any[0] ?? null
}

/**
 * Read reachability: open a raw socket and send a REQ. ANY protocol reply
 * (EVENT / EOSE / NOTICE / CLOSED) means the relay is reachable and speaking
 * Nostr. A raw socket is used (not the pool) because the pool's fetch can't tell
 * "EOSE, no events" or a scoped CLOSED from "never connected" — all resolve empty.
 */
function probeRelayRead(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocket
    let settled = false
    const done = (v: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* already closing */ }
      resolve(v)
    }
    const timer = setTimeout(() => done(false), OP_TIMEOUT)
    try { ws = new WebSocket(url) } catch { resolve(false); return }
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'health', { kinds: [1], limit: 1 }]))
    ws.onmessage = (m) => {
      try {
        const verb = JSON.parse(typeof m.data === 'string' ? m.data : '')[0]
        if (verb === 'EVENT' || verb === 'EOSE' || verb === 'NOTICE' || verb === 'CLOSED') done(true)
      } catch { /* non-JSON frame — ignore */ }
    }
    ws.onerror = () => done(false)
  })
}

/** Write round-trip: re-publish the sweep event to this relay, then read it back by id. */
async function probeRelayWrite(url: string, event: NostrEvent): Promise<boolean> {
  await publishToRelays([url], event, OP_TIMEOUT).catch(() => [])
  for (const wait of READBACK_WAITS) {
    await sleep(wait)
    const got = await fetchEvents([url], { ids: [event.id], limit: 1 }, OP_TIMEOUT).catch(() => [])
    if (got.some((e) => e.id === event.id)) return true
  }
  return false
}

/** The probe event is resolved once per sweep and reused for every write probe. */
interface Sweep { event: NostrEvent | null }

/**
 * Run the relay's configured roles in parallel; it passes this attempt if ANY
 * enabled role works. So a read+write relay is 'broken' only when both read and
 * write fail, and a read-only relay is judged on read alone. A write relay we
 * couldn't resolve a probe event for simply can't pass on write (its read still can).
 */
async function probeRelayOnce(url: string, ctx: Sweep): Promise<boolean> {
  const { read, write } = relayRole(url)
  const tests: Promise<boolean>[] = []
  if (read) tests.push(probeRelayRead(url))
  if (write) tests.push(ctx.event ? probeRelayWrite(url, ctx.event) : Promise.resolve(false))
  if (tests.length === 0) return false
  return (await Promise.all(tests)).some(Boolean)
}

export const useRelayHealthStore = createHealthStore<Sweep>({
  lsKey: 'deg-mods:relay-health',
  openSweep: async () => ({ event: await resolveProbeEvent() }),
  probeOnce: probeRelayOnce,
})
