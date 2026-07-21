import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { AlertTriangle, User, EyeOff, Repeat2, History } from 'lucide-react'
import { LEGACY_MOD_KIND } from '@/lib/mods/legacy' // LEGACY
import { cn } from '@/lib/utils'
import { KINDS } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { useModStatus } from '@/hooks/useModeration'
import { useEffectiveModFlags } from '@/hooks/useModerationTags'
import { useNsfwReveal } from '@/hooks/useNsfwReveal'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import type { ModDetails } from '@/types/mod'

interface ModCardProps {
  mod: ModDetails
}

export function ModCard({ mod }: ModCardProps) {
  const { revealed, reveal } = useNsfwReveal()
  const [author, setAuthor] = useState<UserProfile | null>(null)
  const { moderated } = useModStatus(mod.aTag, mod.pubkey)

  // The author's own tags, plus anything the admin tagged on top.
  const flags = useEffectiveModFlags(mod)
  const hasWarning = !!flags.contentWarning && !revealed
  // Hold the image until the overlay has settled, so a mod the admin marked
  // NSFW can't paint before we know. This races the image download rather than
  // the user — the check is one small query and normally wins, so it isn't
  // seen. Only the image waits; the title, author and layout render at once.
  const holdImage = !flags.checked && !mod.contentWarning

  const naddr = nip19.naddrEncode({
    kind: mod.legacy ? LEGACY_MOD_KIND : KINDS.MOD, // LEGACY
    pubkey: mod.pubkey,
    identifier: mod.dTag,
  })

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(mod.pubkey, relays).then(p => {
      if (!cancelled) setAuthor(p)
    })
    return () => { cancelled = true }
  }, [mod.pubkey])

  const npub = nip19.npubEncode(mod.pubkey)
  const authorName = author?.display_name || `${npub.slice(0, 10)}…`

  return (
    <Link to={`/mod/${naddr}`} className="block group h-full">
      {/* Gradient border wrapper: purple (bottom) to transparent (top), shown on hover */}
      <div className="relative h-full rounded-lg p-0.5">
        <div className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-t from-purple-600 to-transparent to-50% opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <Card className="relative flex h-full flex-col bg-[#1c1c1c] border-0 overflow-hidden rounded-md">
        {/* Image section (wrapper isn't clipped, so the badge can overflow below) */}
        <div className="relative">
          <div className="relative aspect-video overflow-hidden">
            {mod.featuredImageUrl && (
              <SkeletonImage
                src={mod.featuredImageUrl}
                alt={mod.title}
                className={cn(
                  'absolute inset-0 w-full h-full object-cover',
                  (hasWarning || holdImage) && 'blur-xl'
                )}
              />
            )}

            {!mod.featuredImageUrl && (
              <div className="w-full h-full bg-[#212121] flex items-center justify-center">
                <span className="text-neutral-600 text-sm">No image</span>
              </div>
            )}

            {hasWarning && (
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  reveal()
                }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-neutral-300 z-10"
              >
                <AlertTriangle className="w-6 h-6 text-yellow-500" />
                <span className="text-xs font-medium px-3 text-center">
                  {flags.contentWarning}
                </span>
                <span className="text-[10px] text-neutral-500">Click to reveal</span>
              </button>
            )}

            {flags.isRepost && (
              <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-neutral-200 backdrop-blur-sm">
                <Repeat2 className="h-3 w-3" /> Repost
              </span>
            )}
          </div>

          {moderated && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-20 inline-flex items-center gap-1 rounded-md bg-yellow-500/90 px-2 py-0.5 text-[10px] font-semibold text-black whitespace-nowrap shadow">
              <EyeOff className="h-3 w-3" /> Moderated
            </span>
          )}

          {/* LEGACY: old kind-30402 mod marker */}
          {mod.legacy && (
            <span className="absolute bottom-0 left-2 translate-y-1/2 z-20 inline-flex items-center gap-1 rounded-md bg-orange-500/90 px-2 py-0.5 text-[10px] font-semibold text-black whitespace-nowrap shadow">
              <History className="h-3 w-3" /> Legacy
            </span>
          )}
        </div>

        {/* Content section */}
        <div className="flex flex-1 flex-col p-3">
          {/* Title + summary block grows to fill any extra card height */}
          <div className="flex flex-1 flex-col gap-1.5">
            {mod.game && (
              <p className="text-xs text-purple-400 font-medium truncate">{mod.game}</p>
            )}

            <h3 className="font-semibold text-white line-clamp-2 text-sm leading-snug">
              {mod.title}
            </h3>

            {mod.summary && (
              <p className="text-sm text-neutral-400 line-clamp-2 leading-relaxed">
                {mod.summary}
              </p>
            )}
          </div>

          {/* Author */}
          <div className="mt-3 flex items-center gap-2 border-t border-[#262626] pt-3 min-w-0">
            <Avatar className="h-5 w-5 shrink-0">
              {author?.picture ? <AvatarImage src={author.picture} alt={authorName} /> : null}
              <AvatarFallback className="bg-[#212121] text-neutral-400">
                <User className="h-3 w-3" />
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-neutral-400 truncate">{authorName}</span>
          </div>
        </div>
        </Card>
      </div>
    </Link>
  )
}
