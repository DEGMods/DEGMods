import { useState, useEffect } from 'react'
import { useNsfwReveal } from '@/hooks/useNsfwReveal'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { AlertTriangle, User, Clock, Gamepad2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { useNow } from '@/hooks/useNow'
import { jamStatus, jamCountdownLabel, type JamDetails } from '@/lib/nostr/jam'

const STATUS_COLOR: Record<string, string> = {
  upcoming: 'text-sky-400',
  active: 'text-[#fc4462]',
  voting: 'text-amber-400',
  ended: 'text-neutral-500',
}

export function JamCard({ jam }: { jam: JamDetails }) {
  const { revealed, reveal } = useNsfwReveal()
  const [author, setAuthor] = useState<UserProfile | null>(null)
  const now = useNow()
  const hasWarning = !!jam.contentWarning && !revealed
  const status = jamStatus(jam, now)

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(jam.pubkey, relays).then((p) => { if (!cancelled) setAuthor(p) })
    return () => { cancelled = true }
  }, [jam.pubkey])

  const authorName = author?.display_name || `${jam.pubkey.slice(0, 8)}…`
  const gameLabel = jam.games.length === 0 ? 'Any game' : jam.games[0]

  return (
    <Link to={`/mod-jam/${jam.naddr}`} className="block group h-full">
      {/* Watermelon gradient border, shown on hover */}
      <div className="relative h-full rounded-lg p-0.5">
        <div className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-t from-[#fc4462] to-transparent to-50% opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <Card className="relative flex h-full flex-col overflow-hidden rounded-md border-0 bg-[#1c1c1c]">
          <div className="relative aspect-video overflow-hidden">
            {jam.image ? (
              <SkeletonImage src={jam.image} alt={jam.title} className={cn('absolute inset-0 h-full w-full object-cover', hasWarning && 'blur-xl')} />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#212121]"><span className="text-sm text-neutral-600">No image</span></div>
            )}

            {hasWarning && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); reveal() }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/60 text-neutral-300"
              >
                <AlertTriangle className="h-6 w-6 text-yellow-500" />
                <span className="px-3 text-center text-xs font-medium">{jam.contentWarning}</span>
                <span className="text-[10px] text-neutral-500">Click to reveal</span>
              </button>
            )}

            {/* Countdown pill */}
            <span className={cn('absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm', STATUS_COLOR[status])}>
              <Clock className="h-3 w-3" /> {jamCountdownLabel(jam, now)}
            </span>
          </div>

          <div className="flex flex-1 flex-col p-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-[#fc4462]">
                <Gamepad2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{gameLabel}</span>
                {jam.games.length > 1 && (
                  <span className="shrink-0 rounded bg-[#fc4462]/15 px-1 py-0.5 text-[10px] text-[#fc4462]">+{jam.games.length - 1}</span>
                )}
              </div>

              <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white">{jam.title}</h3>
              {jam.summary && <p className="line-clamp-2 text-sm leading-relaxed text-neutral-400">{jam.summary}</p>}
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
