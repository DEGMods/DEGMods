import { useState, useEffect } from 'react'
import { Package } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { constructModListFromEvents } from '@/lib/nostr/events'
import { useModerationFilter } from '@/hooks/useModeration'
import { useBlockFilter } from '@/hooks/useBlock'
import { useWotModFilter } from '@/hooks/useWot'
import { KINDS } from '@/lib/constants'
import type { ModDetails } from '@/types/mod'
import { ModCard } from './ModCard'
import { Skeleton } from '@/components/ui/skeleton'

interface AuthorModsProps {
  pubkey: string
  /** Coordinate (aTag) of the mod currently being viewed, so it's excluded. */
  excludeATag?: string
  limit?: number
}

/**
 * An author's latest mods, shown below a mod post. Fetches the full list and
 * excludes the currently-viewed mod, so there's always a spare to fill its slot.
 */
export function AuthorMods({ pubkey, excludeATag, limit = 4 }: AuthorModsProps) {
  const [mods, setMods] = useState<ModDetails[]>([])
  const [author, setAuthor] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const [events, profile] = await Promise.all([
        fetchEvents(relays, { kinds: [KINDS.MOD], authors: [pubkey] }, 8000),
        useUserStore.getState().fetchProfile(pubkey, relays),
      ])
      if (cancelled) return
      const list = constructModListFromEvents(events)
        .filter(m => m.aTag !== excludeATag)
      setMods(list)
      setAuthor(profile)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [pubkey, excludeATag])

  const moderate = useModerationFilter()
  const blockFilter = useBlockFilter()
  const wotFilter = useWotModFilter()
  const visible = wotFilter(blockFilter(moderate(mods))).slice(0, limit)

  const name = author?.display_name

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-200">
        <Package className="h-5 w-5 text-purple-400" />
        {name ? `More mods from ${name}` : 'More mods from this author'}
      </h2>

      {loading ? (
        <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-video w-full rounded-md" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-neutral-500">No other mods from this author yet.</p>
      ) : (
        <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {visible.map(m => (
            <ModCard key={m.aTag} mod={m} />
          ))}
        </div>
      )}
    </section>
  )
}
