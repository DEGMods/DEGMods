/**
 * Relay health — a write + read-back probe per relay.
 *
 * Reachability alone misses the failure that matters: a relay that opens a
 * socket but silently drops writes (or won't serve events back). So we PUBLISH a
 * known event to the relay and then FETCH it straight back from that same relay.
 * Served back → 'working'; not → 'broken'.
 *
 * The probe reuses ONE already-signed, already-public event for the whole sweep
 * (the user's own recent event if logged in, else any public note) — re-publishing
 * a public event needs no signer and is harmless, and it still proves the relay
 * accepts a write and serves it. Nothing new is ever signed.
 */
import type { Event as NostrEvent } from 'nostr-tools'
import { createHealthStore } from '@/lib/health/healthStore'
import { fetchEvents, publishToRelays } from '@/lib/nostr/relay-pool'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'

// Short per-op deadline so a hanging relay is flagged fast, not after the normal
// 15s publish timeout.
const OP_TIMEOUT = 5000
// Relays routinely EOSE a query before a just-published event is indexed, so read
// back with increasing patience before concluding the write didn't take.
const READBACK_WAITS = [500, 1200, 1900]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Whether a relay is configured as writable in any tier. A write + read-back
 * probe only makes sense for relays we'd publish to; a read-only relay (e.g. a
 * NIP-50 search/indexer) rejects writes BY DESIGN, so write-probing it would
 * always read 'broken' even though it serves reads perfectly. Unknown URL →
 * assume writable (the default for a freshly added relay).
 */
function relayCanWrite(url: string): boolean {
  const s = useSettingsStore.getState()
  for (const list of [s.clientRelays, s.userRelays, s.customRelays]) {
    const r = list.find((x) => x.url === url)
    if (r) return r.write
  }
  return true
}

/**
 * Resolve one event to probe every relay with this sweep. Prefer the user's own
 * recent event; fall back to any public kind-1 note. Returns null if nothing can
 * be fetched (then the sweep is skipped — no labels rather than false 'broken').
 */
async function resolveProbeEvent(): Promise<NostrEvent | null> {
  const read = useSettingsStore.getState().getAllEnabledRelayUrls('read')
  if (read.length === 0) return null
  const pubkey = useAuthStore.getState().pubkey
  if (pubkey) {
    const mine = await fetchEvents(read, { authors: [pubkey], limit: 1 }, OP_TIMEOUT).catch(() => [])
    if (mine[0]) return mine[0]
  }
  const any = await fetchEvents(read, { kinds: [1], limit: 1 }, OP_TIMEOUT).catch(() => [])
  return any[0] ?? null
}

/**
 * Read-only reachability: open a raw socket and send a REQ. ANY protocol reply
 * (EVENT / EOSE / NOTICE / CLOSED) means the relay is reachable and speaking
 * Nostr — enough for a read relay to count as working. We can't require an actual
 * event: a NIP-50 search/indexer relay legitimately returns nothing for a bare
 * filter, and the pool's fetch can't tell "EOSE, no events" from "never connected"
 * (both resolve empty), so a raw socket is used to see the reply itself.
 */
function probeReadRelay(url: string): Promise<boolean> {
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

async function probeRelayOnce(url: string, event: NostrEvent): Promise<boolean> {
  // Read-only relay: can't write to it, so test the thing it IS for — reachable
  // + responds to a read.
  if (!relayCanWrite(url)) return probeReadRelay(url)
  // Write relay: re-publish the already-signed event to just this one relay (no
  // signer — the signature already exists), then read it straight back. A relay
  // that drops the write without an OK is caught by the read-back failing.
  await publishToRelays([url], event, OP_TIMEOUT).catch(() => [])
  for (const wait of READBACK_WAITS) {
    await sleep(wait)
    const got = await fetchEvents([url], { ids: [event.id], limit: 1 }, OP_TIMEOUT).catch(() => [])
    if (got.some((e) => e.id === event.id)) return true
  }
  return false
}

export const useRelayHealthStore = createHealthStore<NostrEvent>({
  lsKey: 'deg-mods:relay-health',
  openSweep: resolveProbeEvent,
  probeOnce: probeRelayOnce,
})
