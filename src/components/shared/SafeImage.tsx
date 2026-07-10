import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  checkImageSize, getCachedSize, addSizeOverride, hasSizeOverride, formatBytes,
} from '@/lib/media/imageSizeGuard'

interface ImageGate {
  /** True when the image exceeds the configured download limit. */
  blocked: boolean
  /** Detected size in bytes, if known. */
  size?: number
  /** Render the image anyway for the rest of this session. */
  override: () => void
}

/**
 * Gate an image URL against the global media download size limit.
 * Fires a HEAD request to learn the size; blocks only when we *know* it's over.
 */
export function useImageSizeGate(url: string | undefined): ImageGate {
  const limitMb = useSettingsStore(s => s.mediaDownloadLimitMb)
  const [overridden, setOverridden] = useState(false)
  const [, bump] = useState(0)

  useEffect(() => { setOverridden(false) }, [url])

  useEffect(() => {
    if (!url || limitMb <= 0) return
    if (getCachedSize(url) !== undefined) return
    let cancelled = false
    checkImageSize(url).finally(() => { if (!cancelled) bump(n => n + 1) })
    return () => { cancelled = true }
  }, [url, limitMb])

  if (!url || limitMb <= 0 || overridden || hasSizeOverride(url)) {
    return { blocked: false, override: () => {} }
  }
  const cached = getCachedSize(url)
  const blocked = typeof cached === 'number' && cached > limitMb * 1024 * 1024
  return {
    blocked,
    size: typeof cached === 'number' ? cached : undefined,
    override: () => { addSizeOverride(url); setOverridden(true) },
  }
}

/** Placeholder shown when an image is over the limit, with a "Load anyway" action. */
export function ImageTooLarge({ size, onOverride, className, compact }: {
  size?: number
  onOverride: () => void
  className?: string
  compact?: boolean
}) {
  if (compact) {
    return (
      <div
        className={cn('flex items-center justify-center bg-[#212121] border border-[#262626] rounded', className)}
        title={size ? `Image too large (${formatBytes(size)}) — over your download limit` : 'Image too large'}
        onClick={(e) => { e.stopPropagation(); onOverride() }}
      >
        <ImageOff className="h-4 w-4 text-neutral-500" />
      </div>
    )
  }
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-lg bg-[#212121] border border-[#262626] py-5 px-4', className)}>
      <ImageOff className="h-5 w-5 text-neutral-500" />
      <div className="text-center">
        <p className="text-xs text-neutral-400">Image too large</p>
        {size != null && size > 0 && <p className="text-[10px] text-neutral-600 mt-0.5">{formatBytes(size)}</p>}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onOverride() }}
        className="text-[11px] text-purple-400/80 hover:text-purple-300 hover:underline transition-colors mt-1"
      >
        Load anyway
      </button>
    </div>
  )
}

type SafeImageProps = ImgHTMLAttributes<HTMLImageElement> & { src: string }

/** A plain <img> gated by the global media download size limit. */
export function SafeImage({ src, className, ...rest }: SafeImageProps) {
  const gate = useImageSizeGate(src)
  if (gate.blocked) {
    return <ImageTooLarge size={gate.size} onOverride={gate.override} className={className} />
  }
  return <img src={src} className={className} {...rest} />
}
