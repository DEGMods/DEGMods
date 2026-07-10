import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Gamepad2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { BlossomImage } from '@/components/shared/BlossomImage'
import type { GameEntry } from '@/types/game'

interface GameCardProps {
  game: GameEntry
  modCount?: number
}

export function GameCard({ game, modCount }: GameCardProps) {
  const imageUrl = game.boxartImage || game.wideImage
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  const placeholder = (
    <div className="w-full h-full bg-gradient-to-br from-purple-900/40 to-[#1c1c1c] flex items-center justify-center">
      <Gamepad2 className="w-10 h-10 text-neutral-600" />
    </div>
  )

  return (
    <Link to={`/game/${encodeURIComponent(game.name)}`} className="block group">
      <div className="bg-[#1c1c1c] rounded-md overflow-hidden transition-transform duration-300 ease-in-out group-hover:scale-[1.03]">
        {/* Boxart image: DVD box ratio ~2:3 */}
        <div className="relative" style={{ aspectRatio: '2 / 3' }}>
          {imageUrl ? (
            <>
              {/* Pulse skeleton while loading — but stop once the image loads OR
                  gives up (a 404 shows the placeholder; don't pulse over it). */}
              {!loaded && !errored && (
                <div className="absolute inset-0 bg-[#262626] animate-pulse" />
              )}
              <BlossomImage
                src={imageUrl}
                alt={game.name}
                // Hidden until loaded so the browser's alt-text (the game name)
                // doesn't flash through the pulsing skeleton while it loads.
                className={`w-full h-full object-cover transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
                fallback={placeholder}
                onLoad={() => setLoaded(true)}
                onError={() => setErrored(true)}
              />
            </>
          ) : (
            placeholder
          )}

          {modCount !== undefined && modCount > 0 && (
            <Badge className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 bg-purple-600 text-white text-[10px] px-2 py-0.5 whitespace-nowrap z-10">
              at least {modCount} {modCount === 1 ? 'mod' : 'mods'}
            </Badge>
          )}
        </div>

        {/* Name */}
        <div className="p-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <h3 className="font-semibold text-white text-sm truncate cursor-pointer">
                {game.name}
              </h3>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {game.name}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </Link>
  )
}
