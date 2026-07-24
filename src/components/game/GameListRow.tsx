import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Gamepad2, ChevronRight } from 'lucide-react'
import { BlossomImage } from '@/components/shared/BlossomImage'
import type { GameEntry } from '@/types/game'

/**
 * Compact list-view row for a game: small boxart thumbnail, name, mod count.
 * The list counterpart to GameCard, chosen via the /games view toggle.
 */
export function GameListRow({ game, modCount }: { game: GameEntry; modCount?: number }) {
  const imageUrl = game.boxartImage || game.wideImage
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  const placeholder = (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-purple-900/40 to-[#1c1c1c]">
      <Gamepad2 className="h-4 w-4 text-neutral-600" />
    </div>
  )

  return (
    <Link
      to={`/game/${encodeURIComponent(game.name)}`}
      className="group flex items-center gap-3 rounded-md border border-[#262626] bg-[#1c1c1c] p-2 pr-3 transition-colors hover:border-[#404040]"
    >
      {/* Thumbnail — same 2:3 boxart ratio as the card, shrunk to a row height. */}
      <div className="relative shrink-0 overflow-hidden rounded" style={{ width: 40, height: 60 }}>
        {imageUrl ? (
          <>
            {!loaded && !errored && <div className="absolute inset-0 animate-pulse bg-[#262626]" />}
            <BlossomImage
              src={imageUrl}
              alt={game.name}
              className={`h-full w-full object-cover transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
              fallback={placeholder}
              onLoad={() => setLoaded(true)}
              onError={() => setErrored(true)}
            />
          </>
        ) : (
          placeholder
        )}
      </div>

      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{game.name}</span>

      {modCount !== undefined && modCount > 0 && (
        <span className="shrink-0 whitespace-nowrap text-xs text-neutral-400">
          at least {modCount} {modCount === 1 ? 'mod' : 'mods'}
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-neutral-600 transition-colors group-hover:text-neutral-400" />
    </Link>
  )
}
