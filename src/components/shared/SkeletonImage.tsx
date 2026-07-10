import { useState } from 'react'
import { cn } from '@/lib/utils'
import { BlossomImage } from './BlossomImage'

interface SkeletonImageProps {
  src: string | undefined
  alt: string
  /** Classes for the <img> itself (sizing, object-fit, etc.). */
  className?: string
  /** Extra classes for the pulsing skeleton overlay. */
  skeletonClassName?: string
  fallback?: React.ReactNode
  loading?: 'lazy' | 'eager'
}

/**
 * Image with a pulsing skeleton placeholder shown while it loads, plus
 * native lazy-loading and Blossom server failover (via BlossomImage).
 *
 * Renders as a fragment, so the PARENT element must be `position: relative`
 * and have a defined size (fixed dimensions or an aspect ratio) for the
 * absolutely-positioned skeleton to fill it.
 */
export function SkeletonImage({
  src,
  alt,
  className,
  skeletonClassName,
  fallback,
  loading = 'lazy',
}: SkeletonImageProps) {
  // "settled" = the image has either loaded or definitively failed.
  const [settled, setSettled] = useState(false)

  return (
    <>
      {src && !settled && (
        <div
          className={cn(
            'absolute inset-0 bg-[#262626] animate-pulse z-[1]',
            skeletonClassName
          )}
        />
      )}
      <BlossomImage
        src={src}
        alt={alt}
        className={className}
        fallback={fallback}
        loading={loading}
        onLoad={() => setSettled(true)}
        onError={() => setSettled(true)}
      />
    </>
  )
}
