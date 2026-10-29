/**
 * imageSizeGuard — global media download size limit enforcement.
 *
 * A single user-configured limit (Settings → Network → Blossom) caps how large
 * an image may be before it's rendered. Size is detected in two tiers:
 *
 *   Tier 1 — a cheap HEAD request reads the Content-Length header. If present,
 *            we know the size without downloading the body.
 *   Tier 2 — when the server returns no Content-Length (and the response is
 *            readable, i.e. CORS-enabled), we GET the body as a stream and count
 *            bytes as they arrive, CANCELLING the moment the running total passes
 *            the limit — so an oversized file is aborted mid-download instead of
 *            being fully fetched. This closes the hole a HEAD-only check leaves:
 *            an attacker's server can omit Content-Length to make a multi-hundred-
 *            MB / GB image "unknown" and sail through.
 *
 * If the size still can't be determined (opaque/blocked cross-origin response,
 * network error) we render optimistically rather than block — a plain <img> can
 * load a no-CORS image without fetch being able to measure it, so failing closed
 * there would just hide legitimate images.
 *
 * Results are cached per URL. Ported from DEN Chat's media guard.
 */

// ── Size cache (URL → bytes, or 'unknown' when size is undeterminable) ──

const sizeCache = new Map<string, number | 'unknown'>()

export function getCachedSize(url: string): number | 'unknown' | undefined {
  return sizeCache.get(url)
}

// ── Session-only "Load anyway" overrides ──

const overrideSet = new Set<string>()
export function addSizeOverride(url: string): void { overrideSet.add(url) }
export function hasSizeOverride(url: string): boolean { return overrideSet.has(url) }

// ── Size check (deduped + cached), two-tier ──

const pending = new Map<string, Promise<number | 'unknown'>>()

/**
 * Determine an image's size, capped by `limitBytes` so Tier 2 can abort an
 * oversized stream early. Returns the byte size (which may be the point at which
 * the stream was cancelled, i.e. > limit, for an oversized file), or 'unknown'
 * when it can't be measured. Deduped + cached per URL.
 */
export async function checkImageSize(url: string, limitBytes: number): Promise<number | 'unknown'> {
  const cached = sizeCache.get(url)
  if (cached !== undefined) return cached
  const inflight = pending.get(url)
  if (inflight) return inflight

  const p = doCheck(url, limitBytes)
  pending.set(url, p)
  try { return await p } finally { pending.delete(url) }
}

async function doCheck(url: string, limitBytes: number): Promise<number | 'unknown'> {
  // Tier 1: HEAD → Content-Length.
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal })
    clearTimeout(timer)
    const cl = res.headers.get('content-length')
    if (cl) {
      const size = Number(cl)
      if (!isNaN(size) && size > 0) { sizeCache.set(url, size); return size }
    }
  } catch {
    // HEAD failed/blocked — fall through to the streaming check.
  }

  // Tier 2: stream the body and count bytes, aborting once over the limit. Only
  // runs when a limit is set; a non-positive limit means "no gating".
  if (limitBytes > 0) {
    const streamed = await streamSize(url, limitBytes)
    if (streamed !== null) { sizeCache.set(url, streamed); return streamed }
  }

  sizeCache.set(url, 'unknown')
  return 'unknown'
}

/**
 * GET the URL and count the body bytes, cancelling the stream as soon as the
 * total exceeds `limitBytes`. Returns the byte count (over the limit when
 * aborted, the true size when it finishes under), or null when the body can't be
 * read (opaque/CORS/error) so the caller falls back to 'unknown'.
 */
async function streamSize(url: string, limitBytes: number): Promise<number | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok || !res.body) return null

    // A Content-Length that only appears on GET is still authoritative.
    const cl = res.headers.get('content-length')
    if (cl) {
      const size = Number(cl)
      if (!isNaN(size) && size > 0) { try { await res.body.cancel() } catch { /* ignore */ } ; return size }
    }

    const reader = res.body.getReader()
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value?.byteLength ?? 0
      if (total > limitBytes) {
        try { await reader.cancel() } catch { /* already done */ }
        return total // oversized — stream aborted here
      }
    }
    return total // finished under the limit
  } catch {
    return null
  }
}

// ── Display helper ──

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
