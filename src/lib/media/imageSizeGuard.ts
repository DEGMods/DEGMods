/**
 * imageSizeGuard — global media download size limit enforcement.
 *
 * A single user-configured limit (Settings → Network → Blossom) caps how large
 * an image may be before it's rendered. Detection is a cheap HEAD request that
 * reads the Content-Length header; results are cached per URL. When the header
 * is missing (CORS / server doesn't send it) we can't know the size, so we
 * render optimistically rather than block.
 *
 * Ported/simplified from DEN Chat's per-category system into one global limit.
 */

// ── Size cache (URL → bytes, or 'unknown' when no Content-Length) ──

const sizeCache = new Map<string, number | 'unknown'>()

export function getCachedSize(url: string): number | 'unknown' | undefined {
  return sizeCache.get(url)
}

// ── Session-only "Load anyway" overrides ──

const overrideSet = new Set<string>()
export function addSizeOverride(url: string): void { overrideSet.add(url) }
export function hasSizeOverride(url: string): boolean { return overrideSet.has(url) }

// ── HEAD-request size check (deduped + cached) ──

const pending = new Map<string, Promise<number | 'unknown'>>()

export async function checkImageSize(url: string): Promise<number | 'unknown'> {
  const cached = sizeCache.get(url)
  if (cached !== undefined) return cached
  const inflight = pending.get(url)
  if (inflight) return inflight

  const p = doHeadCheck(url)
  pending.set(url, p)
  try { return await p } finally { pending.delete(url) }
}

async function doHeadCheck(url: string): Promise<number | 'unknown'> {
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
    sizeCache.set(url, 'unknown')
    return 'unknown'
  } catch {
    sizeCache.set(url, 'unknown')
    return 'unknown'
  }
}

// ── Display helper ──

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
