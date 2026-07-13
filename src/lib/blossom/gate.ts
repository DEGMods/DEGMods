/**
 * Blossom download gates (client side) — BUD-POW + BUD-Ads.
 *
 * A gated server answers an ungated blob GET with `428 Precondition Required`
 * carrying one `X-Blossom-Gate-*` header per unmet gate. The client satisfies
 * every challenge and retries the identical GET with the matching `…-Proof`
 * headers. This module is framework-agnostic: header parsing, PoW mining, ad
 * inventory + rotation, and proof/metric helpers. The UI (mining spinner + ad
 * view timer) lives in the component layer.
 *
 * Deliberately NOT BUD-07 (payment): `428` + a distinct header namespace so a
 * payment client can't mistake this for a payment demand and fails over cleanly.
 */

import type { Event as NostrEvent } from 'nostr-tools'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { KINDS } from '@/lib/constants'

// ─── Challenge types ────────────────────────────────────────────────

export interface PowChallenge {
  /** required leading-zero bits on SHA-256("<c>:<nonce>") */
  bits: number
  /** opaque stateless challenge token, echoed verbatim in the proof */
  c: string
}

export interface AdChallenge {
  /** NIP-78 coordinate of the operator's ad inventory, "30078:<pubkey>:<dtag>" */
  ref: string
  /** minimum on-screen time, milliseconds */
  minMs: number
  /** opaque stateless challenge token, echoed verbatim in the proof */
  c: string
}

export interface GateChallenge {
  pow?: PowChallenge
  ad?: AdChallenge
}

/** True when a fetch Response is a Blossom gate challenge we can try to satisfy. */
export function isGateResponse(res: Response): boolean {
  return res.status === 428 &&
    (res.headers.has('X-Blossom-Gate-Pow') || res.headers.has('X-Blossom-Gate-Ad'))
}

/** Parse `k=v; k2=v2` (semicolon-separated) into a map. Values may contain `:`. */
function parseParams(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const seg of header.split(';')) {
    const eq = seg.indexOf('=')
    if (eq < 0) continue
    out[seg.slice(0, eq).trim()] = seg.slice(eq + 1).trim()
  }
  return out
}

/** Read the gate challenges from a 428 response, or null if none/malformed. */
export function parseGateChallenge(res: Response): GateChallenge | null {
  const challenge: GateChallenge = {}

  const powHeader = res.headers.get('X-Blossom-Gate-Pow')
  if (powHeader) {
    const p = parseParams(powHeader)
    const bits = Number(p.d)
    if (p.c && Number.isFinite(bits) && bits > 0) challenge.pow = { bits, c: p.c }
  }

  const adHeader = res.headers.get('X-Blossom-Gate-Ad')
  if (adHeader) {
    const p = parseParams(adHeader)
    const minMs = Number(p.min)
    if (p.c && p.ref) challenge.ad = { ref: p.ref, minMs: Number.isFinite(minMs) ? minMs : 1000, c: p.c }
  }

  return challenge.pow || challenge.ad ? challenge : null
}

// ─── Proof-of-work (BUD-POW) ────────────────────────────────────────

const encoder = new TextEncoder()

function leadingZeroBits(bytes: Uint8Array): number {
  let n = 0
  for (const x of bytes) {
    if (x === 0) { n += 8; continue }
    n += Math.clz32(x) - 24 // clz32 of a byte, minus the 24 high zero bits of the 32-bit word
    break
  }
  return n
}

async function sha256Bits(s: string): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(s))
  return leadingZeroBits(new Uint8Array(digest))
}

export interface PowProgress {
  hashes: number
  hashRate: number // hashes/sec
}

/**
 * Mine a nonce so that SHA-256("<c>:<nonce>") has ≥ `bits` leading zero bits,
 * matching the server's `leadingZeroBits(sha256(proof))` check. Hashes in
 * parallel batches so the event loop stays responsive and `signal` can abort.
 * Returns the full proof string `<c>:<nonce>`.
 */
export async function solvePow(
  challenge: PowChallenge,
  opts: { onProgress?: (p: PowProgress) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const { onProgress, signal } = opts
  const { c, bits } = challenge
  const BATCH = 256
  let nonce = 0
  let hashes = 0
  const start = performance.now()

  for (;;) {
    if (signal?.aborted) throw new DOMException('PoW aborted', 'AbortError')

    const base = nonce
    const results = await Promise.all(
      Array.from({ length: BATCH }, (_, i) => sha256Bits(`${c}:${base + i}`)),
    )
    for (let i = 0; i < BATCH; i++) {
      if (results[i] >= bits) return `${c}:${base + i}`
    }
    nonce += BATCH
    hashes += BATCH
    const elapsed = (performance.now() - start) / 1000
    onProgress?.({ hashes, hashRate: elapsed > 0 ? Math.round(hashes / elapsed) : 0 })
    // Yield to the paint loop between batches.
    await new Promise((r) => setTimeout(r, 0))
  }
}

export const POW_PROOF_HEADER = 'X-Blossom-Gate-Pow-Proof'
export const AD_PROOF_HEADER = 'X-Blossom-Gate-Ad-Proof'

/** Build the ad proof header value: `<c>; ad=<id>`. */
export function buildAdProof(c: string, adId: string): string {
  return `${c}; ad=${adId}`
}

// ─── Ad inventory (NIP-78) ──────────────────────────────────────────

/** A labelled call-to-action button shown under the ad image. */
export interface AdLink {
  text: string
  link: string
}

export interface Ad {
  id: string
  media: string
  /** Legacy single click-through (pre-buttons). Kept as a fallback CTA. */
  link: string
  alt: string
  weight: number
  /** Up to 3 labelled CTA buttons shown under the image. */
  buttons: AdLink[]
}

/** Parse a `30078:<pubkey>:<dtag>` coordinate. */
export function parseAdRef(ref: string): { kind: number; pubkey: string; dtag: string } | null {
  const parts = ref.split(':')
  if (parts.length < 3) return null
  const kind = Number(parts[0])
  const pubkey = parts[1]
  const dtag = parts.slice(2).join(':') // dtag itself could contain ':'
  if (!Number.isFinite(kind) || !/^[0-9a-f]{64}$/i.test(pubkey) || !dtag) return null
  return { kind, pubkey, dtag }
}

function normalizeAds(content: string): Ad[] {
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { return [] }
  const raw = (parsed as { ads?: unknown })?.ads
  if (!Array.isArray(raw)) return []
  const ads: Ad[] = []
  for (const a of raw) {
    const o = a as Record<string, unknown>
    const id = typeof o?.id === 'string' ? o.id : ''
    const media = typeof o?.media === 'string' ? o.media : ''
    if (!id || !media) continue
    const weight = Number(o?.weight)
    const buttons = Array.isArray(o?.buttons)
      ? (o.buttons as unknown[])
          .map((b) => b as Record<string, unknown>)
          .filter((b) => typeof b?.text === 'string' && typeof b?.link === 'string' && (b.text as string).trim() && (b.link as string).trim())
          .slice(0, 3)
          .map((b) => ({ text: (b.text as string).trim(), link: (b.link as string).trim() }))
      : []
    ads.push({
      id,
      media,
      link: typeof o?.link === 'string' ? o.link : '',
      alt: typeof o?.alt === 'string' ? o.alt : '',
      weight: Number.isFinite(weight) && weight > 0 ? Math.floor(weight) : 1,
      buttons,
    })
  }
  return ads
}

/**
 * Fetch and validate the operator's ad inventory referenced by an ad challenge.
 * Only events authored by the coordinate's pubkey are accepted.
 */
export async function fetchAdInventory(ref: string, relayUrls: string[]): Promise<Ad[]> {
  const coord = parseAdRef(ref)
  if (!coord) return []
  // Multi-pass so a fast relay serving a stale inventory revision can't win over
  // the relay holding the newest one — otherwise a just-added ad is invisible and
  // the modal keeps showing only the older ad(s).
  const ev: NostrEvent | null = await fetchLatestEvent(relayUrls, {
    kinds: [coord.kind || KINDS.GAME_DB],
    authors: [coord.pubkey],
    '#d': [coord.dtag],
  })
  if (!ev || ev.pubkey !== coord.pubkey) return []
  return normalizeAds(ev.content)
}

// ─── Rotation: weighted shuffle-bag (mirrors the site's SidebarAd picker) ──

const AD_ROTATION_PREFIX = 'deg-mods-gate-ad-seen:'

interface RotationState { seen: string[]; last: string }

function loadRotation(key: string): RotationState {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const s = JSON.parse(raw)
      if (Array.isArray(s?.seen)) return { seen: s.seen, last: typeof s.last === 'string' ? s.last : '' }
    }
  } catch { /* ignore */ }
  return { seen: [], last: '' }
}

function saveRotation(key: string, state: RotationState) {
  try { localStorage.setItem(key, JSON.stringify(state)) } catch { /* ignore */ }
}

/**
 * Pick the next ad using a weighted shuffle-bag keyed by the inventory `ref`:
 * every ad appears `weight` times per cycle, each cycle shows all entries before
 * repeating, and the immediately-previous ad isn't shown twice in a row when an
 * alternative exists. `rand` is injectable for tests.
 */
export function pickRotatedAd(ads: Ad[], ref: string, rand: () => number = Math.random): Ad | null {
  if (ads.length === 0) return null
  if (ads.length === 1) {
    saveRotation(AD_ROTATION_PREFIX + ref, { seen: [ads[0].id], last: ads[0].id })
    return ads[0]
  }

  const key = AD_ROTATION_PREFIX + ref
  const ids = new Set(ads.map((a) => a.id))
  const state = loadRotation(key)
  // Drop tracking for ads no longer in inventory (operator edits).
  let seen = new Set(state.seen.filter((id) => ids.has(id)))

  // The bag holds `weight` slots per ad; a slot is "drawn" once its ad is seen.
  const bag: string[] = []
  for (const a of ads) for (let i = 0; i < a.weight; i++) bag.push(a.id)

  let available = bag.filter((id) => !seen.has(id))
  if (available.length === 0) { seen = new Set(); available = bag }

  // Distinct ad ids still available this cycle.
  let choices = [...new Set(available)]
  // Avoid an immediate repeat when another option exists.
  if (choices.length > 1 && state.last) {
    const without = choices.filter((id) => id !== state.last)
    if (without.length) choices = without
  }

  const pickId = choices[Math.floor(rand() * choices.length)]
  seen.add(pickId)
  saveRotation(key, { seen: [...seen], last: pickId })
  return ads.find((a) => a.id === pickId) ?? null
}

// ─── Click reporting (optional, best-effort) ────────────────────────

/** Report an ad click to the serving node's `POST /ads/click` (fire-and-forget). */
export function reportAdClick(nodeBaseUrl: string, adId: string, c: string): void {
  try {
    const body = JSON.stringify({ ad: adId, c })
    const url = `${nodeBaseUrl.replace(/\/+$/, '')}/ads/click`
    // sendBeacon survives the navigation when the click opens a new tab.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
    } else {
      void fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true })
    }
  } catch { /* metrics are best-effort */ }
}

/** The origin (scheme://host[:port]) that issued a gated blob URL. */
export function nodeOrigin(url: string): string {
  try { return new URL(url).origin } catch { return '' }
}
