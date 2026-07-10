import { useState, useEffect, useCallback, useRef } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, ArrowLeft, ArrowRight, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { LazyMount } from '@/components/shared/LazyMount'

// Defensive render cap for events from other clients that allow more.
const SCREENSHOT_RENDER_CAP = 20

interface ModScreenshotsProps {
  screenshots: string[]
  /** Blur the screenshots behind a content-warning until revealed. */
  blurred?: boolean
  onReveal?: () => void
}

export function ModScreenshots({ screenshots, blurred = false, onReveal }: ModScreenshotsProps) {
  const [open, setOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAll, setShowAll] = useState(false)
  // The scroll container element, used as the lazy-load IntersectionObserver root.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)

  const overCap = screenshots.length > SCREENSHOT_RENDER_CAP
  const visible = showAll ? screenshots : screenshots.slice(0, SCREENSHOT_RENDER_CAP)

  const goNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % screenshots.length)
  }, [screenshots.length])

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + screenshots.length) % screenshots.length)
  }, [screenshots.length])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, goNext, goPrev])

  // ── Custom scroller: native bar hidden, custom track + thumb below ──
  const scrollRef = useRef<HTMLDivElement>(null)
  const setScrollEl = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    setScroller(el)
  }, [])
  const trackRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | undefined>(undefined)
  const dragRef = useRef<{ startX: number; startScroll: number; scrollPerPx: number } | null>(null)
  const [metrics, setMetrics] = useState({ scrollable: false, widthPct: 100, leftPct: 0 })

  const update = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    const max = scrollWidth - clientWidth
    const widthPct = scrollWidth > 0 ? Math.min(100, (clientWidth / scrollWidth) * 100) : 100
    const frac = max > 2 ? scrollLeft / max : 0
    setMetrics({ scrollable: max > 2, widthPct, leftPct: frac * (100 - widthPct) })
  }, [])

  useEffect(() => {
    update()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [update, visible.length])

  const stopScroll = useCallback(() => {
    if (rafRef.current !== undefined) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = undefined
    }
  }, [])

  const startScroll = useCallback((dir: -1 | 1) => {
    const el = scrollRef.current
    if (!el) return
    stopScroll()
    const step = () => {
      el.scrollLeft += dir * 12
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [stopScroll])

  // ── Draggable thumb ──
  const onThumbMove = useCallback((e: PointerEvent) => {
    const el = scrollRef.current
    const d = dragRef.current
    if (!el || !d) return
    el.scrollLeft = d.startScroll + (e.clientX - d.startX) * d.scrollPerPx
  }, [])

  const onThumbUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onThumbMove)
    window.removeEventListener('pointerup', onThumbUp)
  }, [onThumbMove])

  const onThumbDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = scrollRef.current
    const track = trackRef.current
    if (!el || !track) return
    const trackW = track.clientWidth
    const thumbW = (metrics.widthPct / 100) * trackW
    const travel = trackW - thumbW
    const max = el.scrollWidth - el.clientWidth
    dragRef.current = {
      startX: e.clientX,
      startScroll: el.scrollLeft,
      scrollPerPx: travel > 0 ? max / travel : 0,
    }
    window.addEventListener('pointermove', onThumbMove)
    window.addEventListener('pointerup', onThumbUp)
  }, [metrics.widthPct, onThumbMove, onThumbUp])

  // Click on the track jumps the view toward that position.
  const onTrackDown = useCallback((e: React.PointerEvent) => {
    const el = scrollRef.current
    const track = trackRef.current
    if (!el || !track) return
    const rect = track.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const max = el.scrollWidth - el.clientWidth
    el.scrollLeft = Math.max(0, Math.min(max, frac * el.scrollWidth - el.clientWidth / 2))
  }, [])

  useEffect(() => () => {
    stopScroll()
    window.removeEventListener('pointermove', onThumbMove)
    window.removeEventListener('pointerup', onThumbUp)
  }, [stopScroll, onThumbMove, onThumbUp])

  if (!screenshots.length) return null

  const openLightbox = (index: number) => {
    setCurrentIndex(index)
    setOpen(true)
  }

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border bg-[#1c1c1c]">
        <div
          ref={setScrollEl}
          className="scrollbar-hide flex gap-3 p-2 overflow-x-auto"
        >
          {visible.map((src, i) => (
            <button
              key={i}
              onClick={() => { if (blurred) { onReveal?.(); return } openLightbox(i) }}
              className={cn(
                'relative aspect-video w-72 shrink-0 overflow-hidden rounded-lg bg-[#212121]',
                'hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-purple-600'
              )}
            >
              {/* Lazy: only fetch a screenshot once it (nearly) scrolls into the carousel. */}
              <LazyMount root={scroller} rootMargin="400px" className="absolute inset-0">
                <SkeletonImage
                  src={src}
                  alt={`Screenshot ${i + 1}`}
                  className={cn('w-full h-full object-cover', blurred && 'blur-xl')}
                />
              </LazyMount>
              {blurred && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-neutral-200">
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                  <span className="text-[10px] font-medium">Click to reveal</span>
                </div>
              )}
            </button>
          ))}
          {overCap && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="flex aspect-video w-44 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#333] bg-[#171717] text-neutral-300 transition-colors hover:border-[#505050] hover:text-white"
            >
              <span className="text-sm font-medium">+{screenshots.length - SCREENSHOT_RENDER_CAP} more</span>
              <span className="text-[11px] text-neutral-500">View all {screenshots.length}</span>
            </button>
          )}
        </div>

        {/* Custom scrollbar footer: arrows (hold to scroll) + draggable thumb */}
        {metrics.scrollable && (
          <div className="flex items-center gap-2 border-t border-[#262626] px-2 py-2">
            <ArrowBtn dir="left" onStart={() => startScroll(-1)} onStop={stopScroll} />
            <div
              ref={trackRef}
              onPointerDown={onTrackDown}
              className="relative h-2.5 flex-1 cursor-pointer rounded-full bg-[#262626]"
            >
              <div
                onPointerDown={onThumbDown}
                style={{ width: `${metrics.widthPct}%`, left: `${metrics.leftPct}%` }}
                className="absolute top-0 h-full rounded-full bg-neutral-600 transition-colors hover:bg-neutral-500 active:bg-purple-500 cursor-grab active:cursor-grabbing"
              />
            </div>
            <ArrowBtn dir="right" onStart={() => startScroll(1)} onStop={stopScroll} />
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl w-full bg-[#1c1c1c] border-0 p-0 overflow-hidden">
          <div className="relative flex items-center justify-center min-h-[300px]">
            {/* Reuse BlossomImage (via SkeletonImage) so a hash-verified screenshot
                already loaded in the carousel renders from its cached blob instead
                of being re-fetched from the Blossom server. */}
            <SkeletonImage
              src={screenshots[currentIndex]}
              alt={`Screenshot ${currentIndex + 1}`}
              loading="eager"
              className="w-full max-h-[80vh] object-contain"
            />

            {screenshots.length > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={goPrev}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white hover:bg-[#2a2a2a]"
                >
                  <ChevronLeft className="w-6 h-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={goNext}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white hover:bg-[#2a2a2a]"
                >
                  <ChevronRight className="w-6 h-6" />
                </Button>
              </>
            )}

            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-neutral-300 text-sm px-3 py-1 rounded-full">
              {currentIndex + 1} / {screenshots.length}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Scrollbar arrow (press and hold to scroll continuously) ────────

function ArrowBtn({
  dir, onStart, onStop,
}: {
  dir: 'left' | 'right'
  onStart: () => void
  onStop: () => void
}) {
  return (
    <button
      type="button"
      aria-label={dir === 'left' ? 'Scroll left' : 'Scroll right'}
      onPointerDown={(e) => { e.preventDefault(); onStart() }}
      onPointerUp={onStop}
      onPointerLeave={onStop}
      onPointerCancel={onStop}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#262626]',
        'text-neutral-300 transition-colors hover:bg-[#2a2a2a] hover:text-white focus:outline-none',
      )}
    >
      {dir === 'left' ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
    </button>
  )
}
