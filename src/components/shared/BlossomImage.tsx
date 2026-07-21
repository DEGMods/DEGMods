import { useState, useCallback, useRef, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { loadVerifiedImage } from '@/lib/blossom/client'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useImageSizeGate, ImageTooLarge } from '@/components/shared/SafeImage'

/**
 * Check if a string looks like a bare SHA-256 hash (64 hex chars).
 */
function isBareHash(str: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(str.trim())
}

/**
 * Extract a SHA-256 hash from a Blossom URL.
 */
function extractHash(url: string): string | null {
  try {
    const u = new URL(url)
    const lastSegment = u.pathname.split('/').pop() || ''
    const base = lastSegment.replace(/\.[^.]+$/, '')
    if (/^[a-fA-F0-9]{64}$/.test(base)) return base
    return null
  } catch {
    return null
  }
}

/**
 * Resolve an image URL. If it's a bare hash, prepend the first Blossom server.
 * If it's already a full URL, return as-is.
 */
export function resolveImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  const trimmed = url.trim()
  if (!trimmed) return undefined

  // Already a full URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }

  // Bare hash: resolve using first Blossom server
  if (isBareHash(trimmed)) {
    const blossomUrls = useSettingsStore.getState().getAllEnabledBlossomUrls()
    if (blossomUrls.length > 0) {
      return `${blossomUrls[0].replace(/\/$/, '')}/${trimmed}`
    }
  }

  return trimmed
}

/**
 * Candidate URLs to verify against, **Blossom servers before the original**.
 *
 * The order matters more than it looks. Plenty of hosts name files after a
 * hash without being content-addressed — image.nostr.build serves a re-encoded
 * copy under the original's hash, so it can never match its own filename.
 * Trying it first meant every such image downloaded the full mismatching file,
 * kept those bytes as the fallback, and only then went looking for the real
 * one. Asking the Blossom servers first usually finds the matching copy
 * immediately and never fetches the bad one at all.
 *
 * The original stays in the list, last, so an image held nowhere else still
 * loads — at the cost of a few quick 404s ahead of it.
 */
function blossomFirst(originalUrl: string, hash: string, ext: string, servers: string[]): string[] {
  return [...new Set([
    ...servers.map((s) => `${s.replace(/\/$/, '')}/${hash}${ext}`),
    originalUrl,
  ])]
}

/**
 * Build alternative Blossom URLs from a hash.
 */
function buildAlternativeUrls(originalUrl: string, hash: string): string[] {
  const blossomUrls = useSettingsStore.getState().getAllEnabledBlossomUrls()
  const ext = originalUrl.match(/(\.[a-zA-Z0-9]+)$/)?.[1] || ''

  return blossomUrls
    .map(server => `${server.replace(/\/$/, '')}/${hash}${ext}`)
    .filter(url => url !== originalUrl)
}

/**
 * Resolve an image to a displayable `src` that SHARES the fetch + verification
 * with <BlossomImage> (via the per-hash cache and in-flight de-dupe in
 * loadVerifiedImage). Use this for a second, decorative rendering of an image
 * that <BlossomImage> already shows — e.g. a blurred slider background — so it
 * reuses the same bytes instead of triggering its own network fetch.
 *
 * Hash-based (Blossom) images resolve to the verified object URL once ready;
 * until then the returned value is `undefined`. Non-hash URLs resolve
 * synchronously to the plain URL.
 */
export function useResolvedImageSrc(src: string | undefined): string | undefined {
  const resolved = resolveImageUrl(src)
  const hash =
    (resolved ? extractHash(resolved) : null) ||
    (src && isBareHash(src.trim()) ? src.trim() : null)
  const [url, setUrl] = useState<string | undefined>(hash ? undefined : resolved)

  useEffect(() => {
    if (!hash || !resolved) { setUrl(resolved); return }
    let cancelled = false
    const servers = useSettingsStore.getState().getAllEnabledBlossomUrls()
    const ext = resolved.match(/(\.[a-zA-Z0-9]+)(?:[?#]|$)/)?.[1] || ''
    const candidates = blossomFirst(resolved, hash, ext, servers)
    loadVerifiedImage(candidates, hash, resolved)
      .then(res => { if (!cancelled) setUrl(res.url || resolved) })
      .catch(() => { if (!cancelled) setUrl(resolved) })
    return () => { cancelled = true }
  }, [resolved, hash])

  return url
}

interface BlossomImageProps {
  src: string | undefined
  alt: string
  className?: string
  fallback?: React.ReactNode
  loading?: 'lazy' | 'eager'
  onLoad?: () => void
  /** Called when the image gives up (no more Blossom servers to try / fallback shown). */
  onError?: () => void
}

/**
 * Image component with Blossom server failover and SHA-256 hash verification.
 *
 * - Resolves bare hashes to full Blossom URLs.
 * - Hash-based URLs are fetched, verified against the hash in the URL, and
 *   failed over across other Blossom servers to find the matching bytes. If no
 *   server has the correct bytes, the image is shown with a "hash mismatch"
 *   warning mark (top-left). Verification is lazy (when scrolled into view) and
 *   cached per hash.
 * - Regular (non-hash) URLs: shown directly, with server failover on load error.
 */
export function BlossomImage(props: BlossomImageProps) {
  const resolvedSrc = resolveImageUrl(props.src)
  const gate = useImageSizeGate(resolvedSrc)
  const hash =
    (resolvedSrc ? extractHash(resolvedSrc) : null) ||
    (props.src && isBareHash(props.src.trim()) ? props.src.trim() : null)

  if (!resolvedSrc) return <>{props.fallback}</>
  if (gate.blocked) return <ImageTooLarge size={gate.size} onOverride={gate.override} className={props.className} />
  if (hash) return <VerifiedImage {...props} resolvedSrc={resolvedSrc} hash={hash} />
  return <SimpleImage {...props} resolvedSrc={resolvedSrc} />
}

// ─── Non-hash: simple failover ──────────────────────────────────────

const MAX_IMG_RETRIES = 3

function SimpleImage({ src, alt, className, fallback, loading = 'lazy', onLoad, onError, resolvedSrc }: BlossomImageProps & { resolvedSrc: string }) {
  const [currentSrc, setCurrentSrc] = useState(resolvedSrc)
  const [failed, setFailed] = useState(false)
  // Bumping the key remounts the <img>, forcing a fresh load attempt of the
  // same URL after a transient failure (without changing the URL).
  const [reloadKey, setReloadKey] = useState(0)
  const retriesRef = useRef(0)
  const triedUrlsRef = useRef<Set<string>>(new Set())

  const handleError = useCallback(() => {
    const hash = extractHash(currentSrc) || (isBareHash(src?.trim() || '') ? src!.trim() : null)
    if (hash) {
      const alternatives = buildAlternativeUrls(currentSrc, hash).filter(url => !triedUrlsRef.current.has(url))
      if (alternatives.length > 0) {
        triedUrlsRef.current.add(currentSrc)
        triedUrlsRef.current.add(alternatives[0])
        retriesRef.current = 0
        setCurrentSrc(alternatives[0])
        return
      }
    }
    // No (more) alternatives: retry the same URL a few times before giving up.
    if (retriesRef.current < MAX_IMG_RETRIES) {
      const n = ++retriesRef.current
      setTimeout(() => setReloadKey(k => k + 1), 600 * n)
      return
    }
    setFailed(true)
    onError?.()
  }, [currentSrc, src, onError])

  if (failed) return <>{fallback}</>
  return (
    <img key={reloadKey} src={currentSrc} alt={alt} className={className} loading={loading} onLoad={onLoad} onError={handleError} />
  )
}

// ─── Hash-based: verified loading ───────────────────────────────────

function VerifiedImage({ alt, className, fallback, loading = 'lazy', onLoad, onError, resolvedSrc, hash }: BlossomImageProps & { resolvedSrc: string; hash: string }) {
  const [result, setResult] = useState<{ url: string; mismatch: boolean } | null>(null)
  const [failed, setFailed] = useState(false)
  const [inView, setInView] = useState(loading === 'eager')
  const [attempt, setAttempt] = useState(0)
  const placeholderRef = useRef<HTMLDivElement>(null)

  // Lazy: only verify once scrolled near the viewport.
  useEffect(() => {
    if (inView) return
    const el = placeholderRef.current
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some(e => e.isIntersecting)) { setInView(true); obs.disconnect() } },
      { rootMargin: '200px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [inView])

  // Retry verification on transient failure (bounded). Bumping `attempt`
  // re-runs the loader, which refetches since failures aren't cached.
  const retry = useCallback(() => {
    if (attempt < MAX_IMG_RETRIES) {
      setResult(null)
      const n = attempt + 1
      setTimeout(() => setAttempt(n), 600 * n)
    } else {
      setFailed(true)
      onError?.()
    }
  }, [attempt, onError])

  useEffect(() => {
    if (!inView) return
    let cancelled = false
    const servers = useSettingsStore.getState().getAllEnabledBlossomUrls()
    const ext = resolvedSrc.match(/(\.[a-zA-Z0-9]+)(?:[?#]|$)/)?.[1] || ''
    const candidates = blossomFirst(resolvedSrc, hash, ext, servers)
    loadVerifiedImage(candidates, hash, resolvedSrc)
      .then(res => {
        if (cancelled) return
        if (!res.url) retry()
        else setResult({ url: res.url, mismatch: res.status === 'mismatch' })
      })
      .catch(() => { if (!cancelled) retry() })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, hash, resolvedSrc, attempt])

  if (failed) return <>{fallback}</>
  // Verification can take a few seconds (it downloads the file to hash it), so
  // the placeholder pulses — a blank box reads as broken, a pulsing one as
  // loading. SkeletonImage layers its own skeleton over this; on its own,
  // BlossomImage still needs to look busy rather than empty.
  if (!result) {
    return <div ref={placeholderRef} className={cn(className, 'animate-pulse bg-[#262626]')} aria-hidden />
  }

  return (
    <>
      <img
        key={attempt}
        src={result.url}
        alt={alt}
        className={className}
        onLoad={onLoad}
        onError={retry}
      />
      {result.mismatch && (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Usually not tampering — image hosts routinely re-encode uploads,
                which changes the bytes and so the hash. Worth surfacing, not
                worth alarming about, so it reads as a note rather than a fault. */}
            <span className="absolute left-1 top-1 z-20 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-neutral-200 backdrop-blur-sm">
              <AlertTriangle className="h-3 w-3 text-yellow-500" /> modified
            </span>
          </TooltipTrigger>
          <TooltipContent>
            The file served doesn't match its hash — the image host has modified it.
          </TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
