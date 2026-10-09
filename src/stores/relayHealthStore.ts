/**
 * Relay health — a read + write round-trip probe per relay.
 *
 * Only relays configured read AND write are probed (the ones we both publish to
 * and read from — the only ones whose health we act on). A relay is 'broken' only
 * when BOTH halves fail:
 *   - read:  a raw socket opens and the relay answers a REQ (any EVENT/EOSE/NOTICE/
 *            CLOSED reply = reachable and speaking Nostr). CLOSED counts too — a
 *            scoped relay like brs rejects an off-scope filter but is clearly up.
 *   - write: re-publish one already-signed event and read it straight back by id.
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

/**
 * Resolve one event to write-probe every relay with this sweep. Prefer the user's
 * own recent MOD (accepted on scoped relays + carries PoW), then any authored
 * event, then any public note. Null → skip the sweep (no labels, not false broken).
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

/** One pass passes if EITHER read or write works — broken needs BOTH to fail. */
async function probeRelayOnce(url: string, event: NostrEvent): Promise<boolean> {
  const [readOk, writeOk] = await Promise.all([
    probeRelayRead(url),
    probeRelayWrite(url, event),
  ])
  return readOk || writeOk
}

export const useRelayHealthStore = createHealthStore<NostrEvent>({
  lsKey: 'deg-mods:relay-health',
  openSweep: resolveProbeEvent,
  probeOnce: probeRelayOnce,
})
