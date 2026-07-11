/**
 * Blossom Client: upload, download, hash verification with failover
 *
 * BUD-01 authentication: signed Nostr events as auth headers
 */

import { LRUCache } from 'lru-cache'
import { isGateResponse, parseGateChallenge, type GateChallenge } from './gate'

// ─── Types ──────────────────────────────────────────────────────────

export interface UploadResult {
  url: string
  hash: string
  size: number
  serverUrl: string
  /** Original filename of the uploaded file (set by the upload UI, not the server). */
  filename?: string
}

export class UploadLimitError extends Error {
  fileSizeMb: number
  limitMb: number
  constructor(fileSizeMb: number, limitMb: number) {
    super(`File size (${fileSizeMb.toFixed(1)} MB) exceeds the upload limit of ${limitMb} MB. You can change this in Settings > Network > Blossom.`)
    this.name = 'UploadLimitError'
    this.fileSizeMb = fileSizeMb
    this.limitMb = limitMb
  }
}

export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

// ─── SHA-256 Hashing ────────────────────────────────────────────────

export async function computeFileHash(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function computeArrayBufferHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── Auth Header (BUD-01) ───────────────────────────────────────────

export async function createBlossomAuthEvent(
  signEvent: (event: Record<string, unknown>) => Promise<Record<string, unknown>>,
  verb: 'upload' | 'delete' | 'list',
  hash?: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const tags: string[][] = [
    ['t', verb],
    ['expiration', (now + 300).toString()],
  ]
  if (hash) tags.push(['x', hash])

  const authEvent = await signEvent({
    kind: 24242,
    content: `Authorize ${verb}`,
    tags,
    created_at: now,
  })
  return 'Nostr ' + btoa(JSON.stringify(authEvent))
}

// ─── Upload ─────────────────────────────────────────────────────────

export async function uploadFile(
  file: File | Blob,
  serverUrl: string,
  authHeader: string,
  onProgress?: (progress: UploadProgress) => void,
  timeoutMs: number = 60000,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const url = `${serverUrl.replace(/\/$/, '')}/upload`
    xhr.open('PUT', url)
    xhr.setRequestHeader('Authorization', authHeader)
    if (file instanceof File) {
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    }
    const timeout = setTimeout(() => {
      xhr.abort()
      reject(new Error(`Upload to ${serverUrl} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({ loaded: e.loaded, total: e.total, percentage: Math.round((e.loaded / e.total) * 100) })
      }
    }
    xhr.onload = () => {
      clearTimeout(timeout)
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText)
          resolve({ url: appendExtension(res.url, file), hash: res.sha256, size: res.size ?? file.size, serverUrl })
        } catch { reject(new Error(`Invalid response from ${serverUrl}`)) }
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
      }
    }
    xhr.onerror = () => { clearTimeout(timeout); reject(new Error(`Network error uploading to ${serverUrl}`)) }
    xhr.send(file)
  })
}

/**
 * Append the original file's extension to a bare-hash Blossom URL (e.g.
 * `…/<sha256>` → `…/<sha256>.zip`). Blossom serves by hash and ignores the
 * extension, but it gives downloads a correct filename and content type instead
 * of an extension-less blob. No-op when the URL already has an extension.
 */
function appendExtension(url: string, file: File | Blob): string {
  const name = file instanceof File ? file.name : ''
  const ext = name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0]
  if (!url || !ext) return url
  try {
    const u = new URL(url)
    const segs = u.pathname.split('/')
    const last = segs[segs.length - 1] || ''
    if (/^[a-fA-F0-9]{64}$/.test(last)) {
      segs[segs.length - 1] = last + ext
      u.pathname = segs.join('/')
      return u.toString()
    }
  } catch { /* non-URL response — leave as-is */ }
  return url
}

// ─── Multi-server Upload with Failover ──────────────────────────────

/**
 * Blossom is content-addressed, so a blob may already exist on a server. A quick
 * HEAD on `<server>/<hash>` lets us skip re-uploading the bytes (and avoids a
 * needless signer prompt). Returns the existing URL (with extension) or null.
 */
async function existingBlobUrl(serverUrl: string, hash: string, file: File | Blob): Promise<string | null> {
  try {
    const base = `${serverUrl.replace(/\/$/, '')}/${hash}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(base, { method: 'HEAD', signal: controller.signal })
    clearTimeout(timer)
    return res.ok ? appendExtension(base, file) : null
  } catch {
    return null
  }
}

export async function uploadToServers(
  file: File | Blob,
  serverUrls: string[],
  signEvent: (event: Record<string, unknown>) => Promise<Record<string, unknown>>,
  onProgress?: (progress: UploadProgress & { serverUrl: string }) => void,
  limitMbOverride?: number,
): Promise<UploadResult> {
  // Enforce the size limit (caller override, else the user's media limit from settings).
  const { useSettingsStore } = await import('@/stores/settingsStore')
  const limitMb = limitMbOverride ?? useSettingsStore.getState().blossomUploadLimitMb
  const fileSizeMb = file.size / (1024 * 1024)
  if (fileSizeMb > limitMb) {
    throw new UploadLimitError(fileSizeMb, limitMb)
  }

  const hash = await computeFileHash(file)
  // Compute the auth header lazily so we don't prompt the signer when the blob
  // already exists everywhere.
  let authHeader: string | null = null
  const getAuth = async () => (authHeader ??= await createBlossomAuthEvent(signEvent, 'upload', hash))
  const errors: Error[] = []
  for (const serverUrl of serverUrls) {
    try {
      const existing = await existingBlobUrl(serverUrl, hash, file)
      if (existing) return { url: existing, hash, size: file.size, serverUrl }
      return await uploadFile(file, serverUrl, await getAuth(), onProgress ? (p) => onProgress({ ...p, serverUrl }) : undefined)
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)))
    }
  }
  throw new Error(`All servers failed:\n${errors.map(e => e.message).join('\n')}`)
}

// ─── Upload to ALL Servers ──────────────────────────────────────────

export async function uploadToAllServers(
  file: File | Blob,
  serverUrls: string[],
  signEvent: (event: Record<string, unknown>) => Promise<Record<string, unknown>>,
  onProgress?: (progress: UploadProgress & { serverUrl: string; serverIndex: number }) => void,
  limitMbOverride?: number,
  // Per-server lifecycle, so the UI can show one bar (with success/fail) per server.
  onServerState?: (serverIndex: number, state: 'uploading' | 'success' | 'error', serverUrl: string) => void,
): Promise<UploadResult[]> {
  // Enforce the size limit (caller override, else the user's media limit from settings).
  const { useSettingsStore } = await import('@/stores/settingsStore')
  const limitMb = limitMbOverride ?? useSettingsStore.getState().blossomUploadLimitMb
  const fileSizeMb = file.size / (1024 * 1024)
  if (fileSizeMb > limitMb) {
    throw new UploadLimitError(fileSizeMb, limitMb)
  }

  const hash = await computeFileHash(file)
  let authHeader: string | null = null
  const getAuth = async () => (authHeader ??= await createBlossomAuthEvent(signEvent, 'upload', hash))
  const results: UploadResult[] = []

  const uploadOne = async (i: number) => {
    onServerState?.(i, 'uploading', serverUrls[i])
    try {
      const existing = await existingBlobUrl(serverUrls[i], hash, file)
      if (existing) {
        results.push({ url: existing, hash, size: file.size, serverUrl: serverUrls[i] })
        onServerState?.(i, 'success', serverUrls[i])
        return
      }
      const result = await uploadFile(file, serverUrls[i], await getAuth(), onProgress ? (p) => onProgress({ ...p, serverUrl: serverUrls[i], serverIndex: i }) : undefined)
      results.push(result)
      onServerState?.(i, 'success', serverUrls[i])
    } catch (err) {
      console.warn(`Upload to ${serverUrls[i]} failed:`, err)
      onServerState?.(i, 'error', serverUrls[i])
    }
  }

  if (useSettingsStore.getState().parallelBlossomUpload) {
    // Upload to up to 3 servers concurrently. Pre-sign the auth once so the
    // concurrent uploads don't each trigger a separate signer prompt.
    await getAuth()
    const BATCH = 3
    for (let i = 0; i < serverUrls.length; i += BATCH) {
      await Promise.all(serverUrls.slice(i, i + BATCH).map((_, j) => uploadOne(i + j)))
    }
  } else {
    for (let i = 0; i < serverUrls.length; i++) await uploadOne(i)
  }

  if (results.length === 0) throw new Error('All servers failed')
  return results
}

// ─── Download with Hash Verification ────────────────────────────────

export async function downloadFile(
  url: string,
  expectedHash?: string,
  timeoutMs: number = 30000,
): Promise<Blob> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    const blob = await response.blob()
    if (expectedHash) {
      const actualHash = await computeFileHash(blob)
      if (actualHash !== expectedHash) {
        throw new Error(`Hash mismatch! Expected ${expectedHash.slice(0, 16)}... got ${actualHash.slice(0, 16)}...`)
      }
    }
    return blob
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

// ─── Download with Failover ─────────────────────────────────────────

export async function downloadWithFailover(
  urls: string[],
  expectedHash?: string,
  timeoutMs: number = 15000,
): Promise<Blob> {
  const errors: Error[] = []
  for (const url of urls) {
    try {
      return await downloadFile(url, expectedHash, timeoutMs)
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)))
    }
  }
  throw new Error(`All download sources failed:\n${errors.map(e => e.message).join('\n')}`)
}

// ─── Streaming Download with Progress ───────────────────────────────

export interface DownloadProgress {
  loaded: number
  total: number          // 0 if the server didn't send Content-Length
  percentage: number     // 0–100, or -1 when total is unknown
  bytesPerSecond: number
}

/**
 * Satisfy a Blossom download gate (BUD-POW / BUD-Ads). Invoked when a source
 * answers `428` with `X-Blossom-Gate-*` challenges; returns the proof headers to
 * retry with (e.g. mine the PoW + show the ad), or throws to abandon this source
 * (which then fails over). `url` is the gated blob URL, so the resolver knows
 * which node it's talking to (for ad-inventory fetch + metrics).
 */
export type GateResolver = (challenge: GateChallenge, url: string) => Promise<Record<string, string>>

/**
 * Download a file while reporting byte-level progress (via ReadableStream),
 * then optionally verify its SHA-256. `stallTimeoutMs` aborts only after a
 * period of no data, so large but actively-transferring files aren't cut off.
 */
export async function downloadFileWithProgress(
  url: string,
  opts: {
    expectedHash?: string
    onProgress?: (p: DownloadProgress) => void
    stallTimeoutMs?: number
    signal?: AbortSignal
    resolveGate?: GateResolver
  } = {},
): Promise<Blob> {
  const { expectedHash, onProgress, stallTimeoutMs = 30000, signal, resolveGate } = opts
  const controller = new AbortController()
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true })

  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), stallTimeoutMs)
  }
  arm()

  try {
    // `no-store`: never keep the (often hundreds-of-MB) file in the browser's HTTP
    // cache — the user already gets the saved file; an invisible second copy would
    // just eat disk. It also guarantees the download gate is re-evaluated instead
    // of a cached 200 slipping past it. Hash verification is unaffected (it hashes
    // whatever bytes come back).
    let response = await fetch(url, { signal: controller.signal, cache: 'no-store' })

    // Download gate (BUD-POW / BUD-Ads): a 428 carries challenge headers. Satisfy
    // them (mine PoW, show ad) and retry the identical GET once with the proofs.
    // The gate-solving pause shouldn't trip the stall timer, so disarm while we
    // resolve, then re-arm for the actual transfer.
    if (resolveGate && isGateResponse(response)) {
      const challenge = parseGateChallenge(response)
      if (challenge) {
        clearTimeout(timer)
        const proofHeaders = await resolveGate(challenge, url)
        arm()
        response = await fetch(url, { signal: controller.signal, headers: proofHeaders, cache: 'no-store' })
      }
    }

    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`)

    const total = Number(response.headers.get('Content-Length')) || 0
    const reader = response.body?.getReader()

    let blob: Blob
    if (!reader) {
      // Streaming unsupported: fall back to a plain blob read.
      blob = await response.blob()
    } else {
      const chunks: BlobPart[] = []
      let loaded = 0
      const start = performance.now()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        arm()
        chunks.push(value)
        loaded += value.length
        const elapsed = (performance.now() - start) / 1000
        const bps = elapsed > 0 ? loaded / elapsed : 0
        onProgress?.({
          loaded,
          total,
          percentage: total ? Math.round((loaded / total) * 100) : -1,
          bytesPerSecond: bps,
        })
      }
      blob = new Blob(chunks)
    }

    clearTimeout(timer)

    if (expectedHash) {
      const actualHash = await computeFileHash(blob)
      if (actualHash !== expectedHash) {
        throw new Error(`Hash mismatch! Expected ${expectedHash.slice(0, 12)}… got ${actualHash.slice(0, 12)}…`)
      }
    }
    return blob
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

/**
 * Try each candidate URL in order until one downloads (and verifies) cleanly.
 */
export async function downloadWithFailoverProgress(
  urls: string[],
  opts: {
    expectedHash?: string
    onProgress?: (p: DownloadProgress) => void
    stallTimeoutMs?: number
    onServerChange?: (url: string, index: number, total: number) => void
    resolveGate?: GateResolver
  } = {},
): Promise<Blob> {
  const errors: string[] = []
  for (let i = 0; i < urls.length; i++) {
    try {
      opts.onServerChange?.(urls[i], i, urls.length)
      return await downloadFileWithProgress(urls[i], opts)
    } catch (err) {
      errors.push(`${urls[i]}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`All download sources failed:\n${errors.join('\n')}`)
}

/**
 * Build an ordered list of download URLs to try: the original URL first, then
 * the same hash served from each enabled Blossom server (for failover).
 */
export function buildDownloadCandidates(
  fileUrl: string,
  hash: string | undefined,
  blossomServers: string[],
): string[] {
  const candidates: string[] = []
  if (fileUrl) candidates.push(fileUrl)
  if (hash && /^[a-f0-9]{64}$/i.test(hash)) {
    const ext = fileUrl.match(/(\.[a-zA-Z0-9]+)(?:[?#]|$)/)?.[1] ?? ''
    for (const server of blossomServers) {
      candidates.push(`${server.replace(/\/$/, '')}/${hash}${ext}`)
    }
  }
  return [...new Set(candidates)]
}

// ─── Verified image loading (hash-checked, with failover) ───────────

export type VerifiedImageStatus = 'verified' | 'mismatch' | 'unverified'

export interface VerifiedImageResult {
  /** Object URL of the fetched bytes, or the original URL when unfetchable. */
  url: string
  status: VerifiedImageStatus
}

// Bounded cache (per hash) so the same media isn't re-fetched/hashed; evicted
// object URLs are revoked to free memory.
const verifiedImageCache = new LRUCache<string, VerifiedImageResult>({
  max: 250,
  dispose: (value) => {
    if (value.url.startsWith('blob:')) URL.revokeObjectURL(value.url)
  },
})

// De-dupe concurrent loads of the same hash: without this, two components that
// mount together (e.g. the slider's foreground image and its blurred background,
// or the same mod in both the slider and the grid) would each kick off their own
// fetch before either populates the result cache. Sharing the in-flight promise
// collapses them into a single network fetch.
const inflightImageLoads = new Map<string, Promise<VerifiedImageResult>>()

/**
 * Fetch and SHA-256-verify an image across candidate URLs (original + other
 * Blossom servers). Returns an object URL for the verified bytes; if no
 * candidate matches the expected hash it returns the first fetched bytes
 * flagged `mismatch`. Cached per hash, and de-duped while in flight.
 */
export function loadVerifiedImage(
  candidates: string[],
  expectedHash: string,
  stallTimeoutMs = 15000,
  attempts = 2,
): Promise<VerifiedImageResult> {
  const cached = verifiedImageCache.get(expectedHash)
  if (cached) return Promise.resolve(cached)

  const inflight = inflightImageLoads.get(expectedHash)
  if (inflight) return inflight

  const load = loadVerifiedImageUncached(candidates, expectedHash, stallTimeoutMs, attempts)
  inflightImageLoads.set(expectedHash, load)
  return load.finally(() => inflightImageLoads.delete(expectedHash))
}

async function loadVerifiedImageUncached(
  candidates: string[],
  expectedHash: string,
  stallTimeoutMs: number,
  attempts: number,
): Promise<VerifiedImageResult> {
  let firstUrl: string | null = null
  // Retry the whole candidate set a few times: a transient disruption (network
  // blip, backgrounded tab aborting the fetch) shouldn't permanently fail it.
  for (let attempt = 0; attempt < attempts; attempt++) {
    for (const url of candidates) {
      try {
        const blob = await downloadFileWithProgress(url, { stallTimeoutMs })
        const actual = await computeFileHash(blob)
        if (actual === expectedHash) {
          const result: VerifiedImageResult = { url: URL.createObjectURL(blob), status: 'verified' }
          verifiedImageCache.set(expectedHash, result)
          if (firstUrl) URL.revokeObjectURL(firstUrl)
          return result
        }
        if (!firstUrl) firstUrl = URL.createObjectURL(blob)
      } catch {
        // try the next candidate
      }
    }
    // Got bytes (just a hash mismatch) — retrying won't change that.
    if (firstUrl) break
    if (attempt < attempts - 1) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }

  if (firstUrl) {
    const result: VerifiedImageResult = { url: firstUrl, status: 'mismatch' }
    verifiedImageCache.set(expectedHash, result)
    return result
  }

  // Everything failed (likely transient). Don't cache, so a later call retries;
  // hand back the original URL so the browser's own <img> load can still try.
  return { url: candidates[0] ?? '', status: 'unverified' }
}

// ─── Hash Verification ──────────────────────────────────────────────

export async function verifyFileHash(file: File | Blob, expectedHash: string): Promise<boolean> {
  const actualHash = await computeFileHash(file)
  return actualHash === expectedHash
}

// ─── Server Health Check ────────────────────────────────────────────

export async function checkServerHealth(serverUrl: string, timeoutMs: number = 5000): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/`, { method: 'HEAD', signal: controller.signal })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}
