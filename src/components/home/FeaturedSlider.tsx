import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { nip19 } from 'nostr-tools'
import { ChevronLeft, ChevronRight, Gamepad2, AlertTriangle, Tag, User, ArrowRight, History } from 'lucide-react'
import { KINDS } from '@/lib/constants'
import { LEGACY_MOD_KIND } from '@/lib/mods/legacy'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { useResolvedImageSrc } from '@/components/shared/BlossomImage'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { SafeImage } from '@/components/shared/SafeImage'
import type { ModDetails } from '@/types/mod'

interface FeaturedSliderProps {
  mods: ModDetails[]
  intervalMs?: number
  transitionMs?: number
}

export function FeaturedSlider({ mods, intervalMs = 8000, transitionMs = 300 }: FeaturedSliderProps) {
  const [index, setIndex] = useState(0)
  const [author, setAuthor] = useState<UserProfile | null>(null)
  const count = mods.length
  const duration = transitionMs / 1000

  const go = useCallback((next: number) => {
    setIndex(i => (((next) % count) + count) % count)
  }, [count])

  // Auto-advance, re-armed whenever the index changes, so a manual click
  // (which changes `index`) resets the countdown to zero.
  useEffect(() => {
    if (count <= 1) return
    const id = setTimeout(() => setIndex(i => (i + 1) % count), intervalMs)
    return () => clearTimeout(id)
  }, [count, intervalMs, index])

  const mod = mods[Math.min(index, Math.max(0, count - 1))]

  // Resolve the current slide's author for the detail panel
  useEffect(() => {
    if (!mod) return
    let cancelled = false
    setAuthor(null)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(mod.pubkey, relays).then(p => {
      if (!cancelled) setAuthor(p)
    })
    return () => { cancelled = true }
  }, [mod?.pubkey, mod?.id])

  if (count === 0 || !mod) return null

  // Legacy mods are kind 30402, not 31142 — encode the mod's actual kind so the
  // link resolves (otherwise the mod page looks up the wrong kind and 404s).
  const naddr = nip19.naddrEncode({
    kind: mod.legacy ? LEGACY_MOD_KIND : KINDS.MOD,
    pubkey: mod.pubkey,
    identifier: mod.dTag,
  })
  const blurred = !!mod.contentWarning
  const npub = nip19.npubEncode(mod.pubkey)
  const authorName = author?.display_name || `${npub.slice(0, 10)}…`

  return (
    <div className="relative overflow-hidden bg-surface-background pt-0 md:pt-6">
      {/* Prev/next peeks, anchored to the centered content's edges (so they sit
          right beside the slide at any width). Desktop only — no room < 1080px. */}
      {count > 1 && (
        <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-full max-w-7xl -translate-x-1/2 min-[1080px]:block">
          <SidePeek mod={mods[(index - 1 + count) % count]} side="left" onClick={() => go(index - 1)} />
          <SidePeek mod={mods[(index + 1) % count]} side="right" onClick={() => go(index + 1)} />
        </div>
      )}

      {/* Foreground: constrained to the page width and centered */}
      <div className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 md:py-8 lg:px-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={mod.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration }}
            className="flex flex-col gap-4 lg:flex-row lg:gap-6"
          >
            {/* Featured image, 16:9 */}
            <Link
              to={`/mod/${naddr}`}
              className="relative block w-full overflow-hidden rounded-xl shadow-md shadow-black/25 lg:basis-[60%]"
            >
              <div className="relative aspect-video">
                <SkeletonImage
                  src={mod.featuredImageUrl}
                  alt={mod.title}
                  loading="eager"
                  className={cn(
                    'absolute inset-0 h-full w-full object-cover',
                    blurred && 'blur-xl',
                  )}
                  fallback={
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-900/40 to-[#171717]">
                      <Gamepad2 className="h-16 w-16 text-neutral-700" />
                    </div>
                  }
                />
                {blurred && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-neutral-200">
                    <AlertTriangle className="h-6 w-6 text-yellow-500" />
                    <span className="text-xs">{mod.contentWarning}</span>
                  </div>
                )}
              </div>
            </Link>

            {/* Detail panel */}
            <div className="flex flex-1 flex-col gap-3 rounded-xl bg-background/80 p-5 shadow-md shadow-black/25 backdrop-blur-xl">
              {mod.game && (
                <Link to={`/game/${encodeURIComponent(mod.game)}`} className="w-fit">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-600/90 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-purple-600">
                    <Gamepad2 className="h-3 w-3" />
                    {mod.game}
                  </span>
                </Link>
              )}

              <h3 className="text-xl font-bold leading-tight text-white line-clamp-2 md:text-2xl">
                {mod.title}
              </h3>

              {/* Publisher */}
              <Link to={`/profile/${npub}`} className="flex w-fit items-center gap-2 text-sm text-neutral-300 hover:text-white">
                {author?.picture ? (
                  <SafeImage src={author.picture} alt="" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#262626]">
                    <User className="h-3.5 w-3.5 text-neutral-400" />
                  </span>
                )}
                <span className="truncate">{authorName}</span>
              </Link>

              {mod.summary && (
                <p className="text-sm text-neutral-400 line-clamp-2">{mod.summary}</p>
              )}

              {/* Categories: clickable hierarchical chains (cat1 › cat2 › cat3) */}
              {mod.categories.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {mod.categories.slice(0, 2).map(cat => {
                    const parts = cat.split(':').filter(Boolean)
                    return (
                      <div key={cat} className="flex w-fit flex-wrap items-center gap-1 rounded-md bg-white/5 px-1.5 py-1">
                        {parts.map((part, i) => {
                          const prefix = parts.slice(0, i + 1).join(':')
                          return (
                            <div key={i} className="flex items-center gap-1">
                              {i > 0 && <ChevronRight className="h-3 w-3 text-neutral-400" />}
                              <Link
                                to={`/mods?category=${encodeURIComponent(prefix)}`}
                                className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-neutral-200 transition-colors hover:bg-purple-500/20 hover:text-purple-200"
                              >
                                {part}
                              </Link>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Tags */}
              {mod.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {mod.tags.slice(0, 4).map(t => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-md border border-purple-500/30 px-2 py-0.5 text-[11px] text-purple-300">
                      <Tag className="h-2.5 w-2.5" />
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-auto flex items-center gap-2 pt-2">
                {/* LEGACY: old kind-30402 mod marker, shown left of the button */}
                {mod.legacy && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-orange-500/90 px-2 py-0.5 text-[11px] font-semibold text-black">
                    <History className="h-3 w-3" /> Legacy
                  </span>
                )}
                <Link
                  to={`/mod/${naddr}`}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
                >
                  View Mod
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Bottom navigation: arrows with slide pills between them */}
        {count > 1 && (
          <div className="mt-5 flex items-center justify-center gap-4">
            <button
              onClick={() => go(index - 1)}
              aria-label="Previous"
              className="rounded-sm bg-white/10 p-1.5 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-1.5">
              {mods.map((m, i) => (
                <button
                  key={m.id}
                  onClick={() => go(i)}
                  aria-label={`Slide ${i + 1}`}
                  className={cn(
                    'h-2 rounded-sm transition-all',
                    i === index ? 'w-6 bg-purple-500' : 'w-2 bg-white/30 hover:bg-white/50',
                  )}
                />
              ))}
            </div>

            <button
              onClick={() => go(index + 1)}
              aria-label="Next"
              className="rounded-sm bg-white/10 p-1.5 text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Prev/next slide preview shown in the slider's side margin. Reuses the shared
// image hook so its bytes are already loaded when it becomes the active slide.
function SidePeek({ mod, side, onClick }: { mod: ModDetails; side: 'left' | 'right'; onClick: () => void }) {
  const url = useResolvedImageSrc(mod.featuredImageUrl)
  // Same rule as the active slide. A peek is smaller and partly faded out by the
  // mask, but it's the same picture — leaving it uncovered put NSFW art on the
  // landing page for anyone whose next or previous slide happened to be one.
  const blurred = !!mod.contentWarning
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous slide' : 'Next slide'}
      style={{
        // Flat fully-transparent zone at the outer edge (0–15%, also swallows the
        // rounded corners there), then a fade ramping to opaque at the inner edge.
        maskImage: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, transparent 15%, #000 100%)`,
        WebkitMaskImage: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, transparent 15%, #000 100%)`,
      }}
      className={cn(
        'pointer-events-auto absolute top-1/2 aspect-video w-[36rem] -translate-y-1/2 overflow-hidden rounded-xl',
        'border border-white/10 opacity-75 shadow-lg shadow-black/40 transition-opacity hover:opacity-100',
        // Inner edge sits just outside the slide with a gap, extending outward.
        side === 'left' ? 'right-full -translate-x-4' : 'left-full translate-x-4',
      )}
    >
      <div className="absolute inset-0 flex items-center justify-center bg-[#171717]">
        <Gamepad2 className="h-8 w-8 text-neutral-700" />
      </div>
      <AnimatePresence initial={false}>
        {url && (
          <motion.img
            key={url}
            src={url}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className={cn('absolute inset-0 h-full w-full object-cover', blurred && 'blur-xl')}
          />
        )}
      </AnimatePresence>
      {blurred && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
        </div>
      )}
    </button>
  )
}
