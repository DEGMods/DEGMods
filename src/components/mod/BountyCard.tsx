import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Gamepad2, Gift, CheckCircle2, CircleDashed, AlertTriangle, User } from 'lucide-react'
import { useNsfwReveal } from '@/hooks/useNsfwReveal'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import type { BountyDetails } from '@/lib/nostr/bounty'
import { cn } from '@/lib/utils'

/** A mod-request (bounty) card. Mirrors ModCard/JamCard with the orange accent. */
export function BountyCard({ bounty: b }: { bounty: BountyDetails }) {
  const { revealed, reveal } = useNsfwReveal()
  const [author, setAuthor] = useState<UserProfile | null>(null)
  const hasWarning = !!b.contentWarning && !revealed

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(b.pubkey, relays).then((p) => { if (!cancelled) setAuthor(p) })
    return () => { cancelled = true }
  }, [b.pubkey])

  const authorName = author?.display_name || `${b.pubkey.slice(0, 8)}…`

  return (
    <Link to={`/mod-request/${b.naddr}`} className="group block h-full">
      {/* Orange gradient border, shown on hover */}
      <div className="relative h-full rounded-lg p-0.5">
        <div className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-t from-orange-500 to-transparent to-50% opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <Card className="relative flex h-full flex-col overflow-hidden rounded-md border-0 bg-[#1c1c1c]">
          <div className="relative aspect-video overflow-hidden">
            {b.image ? (
              <SkeletonImage src={b.image} alt={b.title} className={cn('absolute inset-0 h-full w-full object-cover', hasWarning && 'blur-xl')} />
            ) : (
              <img src="/hub-banner-placeholder.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}

            {hasWarning && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); reveal() }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/60 text-neutral-300"
              >
                <AlertTriangle className="h-6 w-6 text-yellow-500" />
                <span className="px-3 text-center text-xs font-medium">{b.contentWarning}</span>
                <span className="text-[10px] text-neutral-500">Click to reveal</span>
              </button>
            )}

            {/* Status pill */}
            <span className={cn('absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm', b.fulfilled ? 'text-emerald-400' : 'text-amber-400')}>
              {b.fulfilled ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
              {b.fulfilled ? 'Fulfilled' : 'Open'}
            </span>
          </div>

          <div className="flex flex-1 flex-col p-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-orange-400">
                <Gamepad2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{b.game}</span>
              </div>

              <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white">{b.title}</h3>
              {b.summary && <p className="line-clamp-2 text-sm leading-relaxed text-neutral-400">{b.summary}</p>}

              {b.reward && (
                <p className="flex items-center gap-1.5 text-xs text-orange-400">
                  <Gift className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{b.reward.what}{b.reward.how ? ` (${b.reward.how})` : ''}</span>
                </p>
              )}
            </div>

            <div className="mt-3 flex min-w-0 items-center gap-2 border-t border-[#262626] pt-3">
              <Avatar className="h-5 w-5 shrink-0">
                {author?.picture ? <AvatarImage src={author.picture} alt={authorName} /> : null}
                <AvatarFallback className="bg-[#212121] text-neutral-400"><User className="h-3 w-3" /></AvatarFallback>
              </Avatar>
              <span className="truncate text-xs text-neutral-400">{authorName}</span>
            </div>
          </div>
        </Card>
      </div>
    </Link>
  )
}
