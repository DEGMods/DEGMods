/**
 * NIP-LRS: Local Relay Signer (client side).
 *
 * A desktop signer runs a minimal NIP-01 relay bound to loopback and advertises
 * itself with an NIP-11 info document carrying a `local_relay_signer` marker. We
 * discover it by scanning a small port range, then speak ordinary NIP-46 to it
 * over `ws://127.0.0.1:<port>` — so the whole thing is our existing bunker client
 * pointed at localhost. No key material and no relays leave the machine, and
 * there is no pairing string to paste on the discovery path.
 *
 * Identity is the signer's random `transport_pubkey` (pinned TOFU); the port is
 * only a cache. An account pubkey is never disclosed at discovery — it comes back
 * from `get_public_key` only after the user approves the connection in the
 * signer's own UI.
 *
 * See docs: NIP-LRS. This module is the client; serving the info document, the
 * Private Network Access preflight, and the loopback relay are the signer's job.
 */

import { generateSecretKey } from 'nostr-tools'
import { bytesToHex } from '@noble/hashes/utils'
import { BunkerSigner } from './bunker'
import { StorageKey, CLIENT_NAME } from '@/lib/constants'

/** The scan range is a shared constant: signers bind the first free port here. */
export const LRS_PORT_START = 7777
export const LRS_PORT_END = 7786 // inclusive — ten ports (spec §4)

// Discovery is flaky: a known signer bug resets ~40% of browser connections to
// its info endpoint (field note). Keep per-probe timeouts short so dead ports
// don't stall the scan, retry each probe, and re-scan the range a few times
// before concluding "no signer".
const PROBE_TIMEOUT_MS = 1200
const PROBE_RETRIES = 2
const SCAN_ROUNDS = 3

// Per-request timeout for the local signer (nostr-tools arms one on every
// request; default 30s). First connect blocks on the user approving it in the
// signer's own window — there's no pairing secret and no web auth-URL redirect on
// the scan path — so it needs a generous window. Loopback requests return in
// milliseconds, so this long ceiling only ever bounds a genuinely dead signer.
const LRS_REQUEST_TIMEOUT_MS = 120_000

const HEX64 = /^[0-9a-f]{64}$/i

export interface LocalSigner {
  /** Self-declared and untrusted — a display label only, never identity. */
  name: string
  /** The signer's transport key: the pinned identity and the NIP-46 remote key. */
  transportPubkey: string
  port: number
}

function portRange(): number[] {
  const out: number[] = []
  for (let p = LRS_PORT_START; p <= LRS_PORT_END; p++) out.push(p)
  return out
}

/**
 * A short, display-only fingerprint of the transport key. Two signers can self-
 * declare the same name, so UIs disambiguate by this, never by name alone.
 */
export function lrsFingerprint(transportPubkey: string): string {
  return `${transportPubkey.slice(0, 8)}…${transportPubkey.slice(-4)}`
}

/** `bunker://<transport_pubkey>?relay=ws://127.0.0.1:<port>` — ordinary NIP-46. */
function bunkerUrlFor(info: LocalSigner): string {
  return `bunker://${info.transportPubkey}?relay=ws://127.0.0.1:${info.port}`
}

const appMetadata = () => ({
  name: CLIENT_NAME,
  url: typeof window !== 'undefined' ? window.location.origin : '',
})

// ─── Discovery ──────────────────────────────────────────────────────

/**
 * GET the NIP-11 info document on one port. A port is a signer only if the doc
 * carries a `local_relay_signer` marker with a valid transport key — an ordinary
 * relay doesn't, so it's skipped. This is a capability test, never a check
 * against a known list of keys or names.
 *
 * The non-simple `Accept` header makes the browser fire a Private Network Access
 * preflight; answering it is the signer's responsibility. `http://127.0.0.1` is a
 * secure context, so an HTTPS page may reach it without mixed-content blocking.
 */
async function probePort(port: number): Promise<LocalSigner | null> {
  for (let attempt = 0; attempt <= PROBE_RETRIES; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { Accept: 'application/nostr+json' },
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (!res.ok) return null
      const doc = await res.json().catch(() => null)
      const marker = doc?.local_relay_signer
      const tp =
        typeof marker?.transport_pubkey === 'string' ? marker.transport_pubkey.toLowerCase() : null
      if (!marker || !tp || !HEX64.test(tp)) return null // relay / not a signer
      const name =
        typeof doc?.name === 'string' && doc.name.trim() ? doc.name.trim() : 'Local signer'
      return { name, transportPubkey: tp, port }
    } catch (err) {
      clearTimeout(timer)
      // Our own timeout (AbortError) means the port is dead or hung — give up on
      // it. A fast failure (connection reset by the signer's socket bug, or a
      // refused dead port) is worth another try; a browser fetch can't surface
      // the net::ERR_* reason, so we can't be surgical and retry either way.
      if ((err as Error)?.name === 'AbortError') return null
    }
  }
  return null
}

/**
 * Scan the range for signers. Probes all ports in parallel, and re-scans up to a
 * few rounds because a single pass misses a flaky signer almost half the time —
 * "no button, but it's right there". Stops at the first round that finds one.
 */
export async function scanForSigners(): Promise<LocalSigner[]> {
  const found = new Map<string, LocalSigner>()
  for (let round = 0; round < SCAN_ROUNDS; round++) {
    const results = await Promise.all(portRange().map(probePort))
    for (const r of results) if (r) found.set(r.transportPubkey, r)
    if (found.size > 0) break
  }
  return [...found.values()]
}

// ─── Per-signer client key (keyed by transport key, survives logout) ─
//
// Default bunker libraries mint a fresh client key each session, so the signer
// sees a new client on every login and piles up duplicate connections. Persist
// one client key per signer instead: it survives logout, so re-login reuses the
// key the signer already approved — no duplicates, and the signer resumes the
// stored policy without re-prompting.

type ClientKeyMap = Record<string, string>

function readClientKeys(): ClientKeyMap {
  try {
    const raw = localStorage.getItem(StorageKey.LRS_CLIENT_KEYS)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as ClientKeyMap) : {}
  } catch {
    return {}
  }
}

function getOrCreateClientKey(transportPubkey: string): string {
  const map = readClientKeys()
  const existing = map[transportPubkey]
  if (existing && HEX64.test(existing)) return existing
  const key = bytesToHex(generateSecretKey())
  map[transportPubkey] = key
  try {
    localStorage.setItem(StorageKey.LRS_CLIENT_KEYS, JSON.stringify(map))
  } catch {
    /* ignore */
  }
  return key
}

// ─── Session pin (for restore): transport key is identity, port is a cache ──

interface LrsPin {
  transportPubkey: string
  accountPubkey: string
  lastPort: number
}

function savePin(pin: LrsPin): void {
  try {
    localStorage.setItem(StorageKey.LRS_PIN, JSON.stringify(pin))
  } catch {
    /* ignore */
  }
}

function readPin(): LrsPin | null {
  try {
    const p = JSON.parse(localStorage.getItem(StorageKey.LRS_PIN) || 'null')
    return p && HEX64.test(p.transportPubkey) && HEX64.test(p.accountPubkey) ? (p as LrsPin) : null
  } catch {
    return null
  }
}

/** Forget the active session's pin (on logout). The client-key map is kept. */
export function clearLrsPin(): void {
  try {
    localStorage.removeItem(StorageKey.LRS_PIN)
  } catch {
    /* ignore */
  }
}

// ─── Connect / reconnect ────────────────────────────────────────────

export interface LrsConnection {
  signer: BunkerSigner
  pubkey: string
}

/**
 * Connect to a discovered signer. On first contact this blocks until the user
 * approves in the signer's UI, then `get_public_key` returns the account — the
 * first point at which it's disclosed. The transport key is pinned (TOFU) and
 * the account remembered, so a later launch reconnects to the same signer.
 */
export async function connectLocalSigner(info: LocalSigner): Promise<LrsConnection> {
  const clientKey = getOrCreateClientKey(info.transportPubkey)
  const signer = new BunkerSigner(clientKey)
  const pubkey = await signer.login(bunkerUrlFor(info), true, {
    metadata: appMetadata(),
    timeout: LRS_REQUEST_TIMEOUT_MS,
  })
  savePin({ transportPubkey: info.transportPubkey, accountPubkey: pubkey, lastPort: info.port })
  return { signer, pubkey }
}

/**
 * Re-establish the pinned session on launch (used by restore). Tries the last-
 * known port first, then rescans; reconnects only to the port whose marker
 * presents the pinned transport key. If no listening port presents it the signer
 * is offline — returns null rather than connecting to a different signer that
 * happened to grab the old port. The stored client key lets this resume without
 * a fresh approval.
 */
export async function reconnectLocalSigner(): Promise<LrsConnection | null> {
  const pin = readPin()
  if (!pin) return null

  // Fast path: the remembered port, verified against the pinned key.
  let info: LocalSigner | null = null
  const atLastPort = await probePort(pin.lastPort)
  if (atLastPort && atLastPort.transportPubkey === pin.transportPubkey) {
    info = atLastPort
  } else {
    const all = await scanForSigners()
    info = all.find((s) => s.transportPubkey === pin.transportPubkey) ?? null
  }
  if (!info) return null // signer offline — do not fall back to another signer

  const clientKey = getOrCreateClientKey(pin.transportPubkey)
  const signer = new BunkerSigner(clientKey)
  // Not an initial connection: the stored client key is already approved, so no
  // metadata and no fresh handshake prompt. Keep the long request timeout in case
  // the signer no longer recognizes the key and re-prompts for approval.
  const pubkey = await signer.login(bunkerUrlFor(info), false, { timeout: LRS_REQUEST_TIMEOUT_MS })
  if (pubkey !== pin.accountPubkey) {
    // The signer answered as a different account than we logged in with; keep the
    // connection but let the caller's account-mismatch guard handle it.
    savePin({ ...pin, accountPubkey: pubkey, lastPort: info.port })
  } else if (info.port !== pin.lastPort) {
    savePin({ ...pin, lastPort: info.port })
  }
  return { signer, pubkey }
}
