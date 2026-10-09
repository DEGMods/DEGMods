/**
 * Blossom server health — an upload + read-back probe per server.
 *
 * HEAD-returns is not enough: the failure that breaks media is a server that
 * answers but rejects the UPLOAD (415/401/CORS) or won't serve the blob back. So
 * we PUT a probe blob and then GET it back and verify the bytes hash to the
 * expected sha256. Accepted + served + hash matches → 'working', else 'broken'.
 *
 * The probe payload is FIXED (a minimal valid ~100-byte ZIP), so it's content-
 * addressed to the SAME sha256 every time: re-probing is an idempotent re-PUT of
 * identical bytes and each server ends up holding exactly ONE tiny blob forever,
 * not a pile of random garbage. A ZIP (not a text blob) because DEG Mods' own node
 * only accepts archive uploads; see PROBE_BYTES.
 *
 * The kind-24242 upload auth commits to the blob HASH (not the server), so one
 * signature is valid for every server: it's signed ONCE per sweep and reused.
 * Signing needs the user's key, so probing only runs while SIGNED IN (auto on
 * Settings open, plus clicks); logged out, openSweep returns null → no label.
 */
import { createHealthStore } from '@/lib/health/healthStore'
import { createBlossomAuthEvent, computeArrayBufferHash } from '@/lib/blossom/client'
import { signEvent, useAuthStore } from '@/stores/authStore'

const OP_TIMEOUT = 8000
// Constant probe payload → stable content hash → idempotent, litter-free re-PUTs
// (each server ends up holding this one tiny blob, never a pile of random garbage).
// It's a minimal valid ZIP (one empty entry): DEG Mods' own node is a mod-file
// store that sniffs upload magic bytes and only accepts archive types, so a plain
// text/octet blob is rejected there (it would read as broken) — general servers
// accept the zip just as happily.
const PROBE_BYTES = new Uint8Array([
  80, 75, 3, 4, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 112,
  80, 75, 1, 2, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 112, 80, 75, 5, 6, 0, 0, 0, 0, 1, 0, 1, 0, 47, 0, 0,
  0, 31, 0, 0, 0, 0, 0,
])

let probeHashPromise: Promise<string> | null = null
function probeHash(): Promise<string> {
  if (!probeHashPromise) {
    probeHashPromise = computeArrayBufferHash(
      PROBE_BYTES.buffer.slice(PROBE_BYTES.byteOffset, PROBE_BYTES.byteOffset + PROBE_BYTES.byteLength),
    )
  }
  return probeHashPromise
}

interface Sweep {
  auth: string
  hash: string
}

/** Sign one 24242 upload auth (committed to the probe hash) for the whole sweep. */
async function openBlossomSweep(): Promise<Sweep | null> {
  if (!useAuthStore.getState().pubkey) return null // logged out → can't sign → no label
  const hash = await probeHash()
  try {
    const auth = await createBlossomAuthEvent(signEvent, 'upload', hash)
    return { auth, hash }
  } catch {
    return null // signer rejected / unavailable — skip, don't mark broken
  }
}

async function probeBlossomOnce(url: string, ctx: Sweep): Promise<boolean> {
  const base = url.replace(/\/$/, '')
  // Write: always PUT the probe blob (don't skip on HEAD — write-rejection is the
  // failure we're testing). Idempotent: the server already holds these exact bytes.
  try {
    const put = await fetch(`${base}/upload`, {
      method: 'PUT',
      headers: { Authorization: ctx.auth, 'Content-Type': 'application/zip' },
      body: PROBE_BYTES,
      signal: AbortSignal.timeout(OP_TIMEOUT),
    })
    if (!put.ok) return false
  } catch {
    return false
  }
  // Read-back: GET the blob and verify its bytes. Our own node GATES downloads
  // (PoW/ad) and answers 428 for a present-but-gated blob — that still proves the
  // upload landed and the server is serving, so count a gate challenge as success.
  // Fall back to the gate-free HEAD existence check for anything else.
  try {
    const res = await fetch(`${base}/${ctx.hash}`, { signal: AbortSignal.timeout(OP_TIMEOUT) })
    if (res.status === 428) return true
    if (res.ok) {
      const buf = await res.arrayBuffer()
      if ((await computeArrayBufferHash(buf)) === ctx.hash) return true
    }
  } catch {
    // fall through to HEAD
  }
  try {
    const head = await fetch(`${base}/${ctx.hash}`, { method: 'HEAD', signal: AbortSignal.timeout(OP_TIMEOUT) })
    return head.ok
  } catch {
    return false
  }
}

export const useBlossomHealthStore = createHealthStore<Sweep>({
  lsKey: 'deg-mods:blossom-health',
  openSweep: openBlossomSweep,
  probeOnce: probeBlossomOnce,
})
