/**
 * blobRedundancy — cooperative Blossom-blob replication (the blob analog of
 * eventRedundancy).
 *
 * Blossom servers can drop blobs over time. This keeps important blobs — the
 * games-db CSV shards — alive: a logged-in visitor checks how many servers still
 * hold each blob and, if it's on fewer than MIN_REDUNDANCY, re-mirrors it to
 * random working servers that lack it. Unlike event rebroadcasting, a blob upload
 * must be signed (kind-24242), so this runs for SIGNED-IN users only.
 *
 * Re-mirror strategy per target (the cheaper one first):
 *   1. BUD-04 `PUT /mirror` — the target server pulls the blob from a source URL
 *      itself, so no bytes cross the visitor's connection.
 *   2. Fallback: download the blob from a source and re-upload it (`PUT /upload`).
 *
 * Targets are chosen at random from the servers that answered the presence check
 * but don't have the blob (reachable + lacking = "working ones" to mirror to).
 * Checks are deduped per session and run through a sequential queue so we never
 * flood servers, and the signer is only ever invoked when a blob is actually
 * under-replicated (so the common, well-replicated case prompts nothing).
 */
import { createBlossomAuthEvent, downloadFile } from '@/lib/blossom/client'
import { signEvent, useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'

/** A blob is "safe" once at least this many servers hold it. */
const MIN_REDUNDANCY = 3
const HEAD_TIMEOUT = 5000
const OP_TIMEOUT = 20000

const norm = (u: string) => u.replace(/\/+$/, '')

// ── Session dedup + sequential queue (same shape as eventRedundancy) ──
const checkedThisSession = new Set<string>()
const queue: Array<() => Promise<void>> = []
let processing = false

function enqueue(task: () => Promise<void>) {
  queue.push(task)
  if (processing) return
  processing = true
  void (async () => {
    while (queue.length) {
      const t = queue.shift()!
      try { await t() } catch (err) { console.warn('[BlobRedundancy] task failed:', err) }
    }
    processing = false
  })()
}

/** 'has' = serves it, 'lacking' = reachable but doesn't have it (a mirror target), 'down' = unreachable. */
async function presence(server: string, hash: string): Promise<'has' | 'lacking' | 'down'> {
  try {
    const res = await fetch(`${norm(server)}/${hash}`, { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT) })
    return res.ok ? 'has' : 'lacking'
  } catch {
    return 'down'
  }
}

/** Replicate one blob from a source server to `target`, server-pull first then client copy. */
async function mirrorTo(target: string, sourceUrl: string, hash: string, auth: string): Promise<boolean> {
  // 1. BUD-04 server-side mirror — no bytes through the visitor.
  try {
    const res = await fetch(`${target}/mirror`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl }),
      signal: AbortSignal.timeout(OP_TIMEOUT),
    })
    if (res.ok) return true
  } catch {
    // fall through to the download + upload copy
  }
  // 2. Fallback: pull the bytes (hash-verified) and push them.
  try {
    const blob = await downloadFile(sourceUrl, hash, OP_TIMEOUT)
    const res = await fetch(`${target}/upload`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
      signal: AbortSignal.timeout(OP_TIMEOUT),
    })
    return res.ok
  } catch {
    return false
  }
}

async function ensureOne(hash: string): Promise<void> {
  // Non-pinned servers only — brs is archive-only and never holds CSVs. The media
  // list is the full non-pinned set, already shuffled, so slicing gives random picks.
  const servers = useSettingsStore.getState().getMediaBlossomUrls()
  if (servers.length === 0) return

  const checked = await Promise.all(servers.map(async (s) => ({ url: norm(s), state: await presence(s, hash) })))
  const have = checked.filter((c) => c.state === 'has').map((c) => c.url)
  const lacking = checked.filter((c) => c.state === 'lacking').map((c) => c.url) // reachable + missing

  // Enough copies already, or nobody has it (then there's no source to copy from).
  if (have.length >= MIN_REDUNDANCY || have.length === 0) return

  const targets = lacking.slice(0, MIN_REDUNDANCY - have.length) // shuffled upstream → random
  if (targets.length === 0) return

  // One signature per blob, reused across its targets. Only reached when actually
  // under-replicated, so a healthy games DB never prompts the signer.
  const auth = await createBlossomAuthEvent(signEvent, 'upload', hash)
  const source = `${have[0]}/${hash}`

  let added = 0
  for (const t of targets) if (await mirrorTo(t, source, hash, auth)) added++
  console.log(`[BlobRedundancy] ${hash.slice(0, 8)}…: ${have.length} + ${added} new = ${have.length + added} copies`)
}

/**
 * Ensure each of `hashes` is on at least MIN_REDUNDANCY Blossom servers, mirroring
 * to more when short. No-op when logged out (can't sign an upload). Deduped per
 * session, processed one at a time.
 */
export function ensureBlobsReplicated(hashes: string[]): void {
  if (!useAuthStore.getState().pubkey) return // signed-in only
  for (const hash of hashes) {
    if (!hash || checkedThisSession.has(hash)) continue
    checkedThisSession.add(hash)
    enqueue(() => ensureOne(hash))
  }
}
