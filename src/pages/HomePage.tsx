import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { ModCard } from '@/components/mod/ModCard'
import { GameCard } from '@/components/game/GameCard'
import { BlogPostCard } from '@/components/blog/BlogPostCard'
import { FeaturedSlider } from '@/components/home/FeaturedSlider'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { useGamesDbStore } from '@/stores/gamesDbStore'
import { useModerationFilter } from '@/hooks/useModeration'
import { useBlockFilter } from '@/hooks/useBlock'
import { useWotModFilter } from '@/hooks/useWot'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import type { Event as NostrEvent } from 'nostr-tools'
import { constructModListFromEvents, extractBlogData } from '@/lib/nostr/events'
import { LEGACY_MOD_KIND, extractLegacyModData, isLegacyModEvent, normalizeModCoord } from '@/lib/mods/legacy'
import { KINDS, ADMIN_PUBKEY } from '@/lib/constants'
import type { ModDetails } from '@/types/mod'
import type { BlogDetails } from '@/types/blog'
import type { GameEntry } from '@/types/game'

const NIP78_KIND = 30078
const HOME_TTL = 2 * 60 * 1000

// Home data survives navigation so returning is instant instead of re-fetching
// everything and flashing skeletons. Refreshed in the background past the TTL.
interface HomeCache {
  at: number
  mods: ModDetails[]
  sliderMods: ModDetails[]
  featuredMods: ModDetails[]
  games: GameEntry[]
  blogs: BlogDetails[]
  blogAuthors: Map<string, UserProfile>
}
let homeCache: HomeCache | null = null

export function HomePage() {
  const getGameImages = useGamesDbStore(s => s.getGameImages)

  const [mods, setMods] = useState<ModDetails[]>(() => homeCache?.mods ?? [])
  const [sliderMods, setSliderMods] = useState<ModDetails[]>(() => homeCache?.sliderMods ?? [])
  const [featuredMods, setFeaturedMods] = useState<ModDetails[]>(() => homeCache?.featuredMods ?? [])
  const [games, setGames] = useState<GameEntry[]>(() => homeCache?.games ?? [])
  const [blogs, setBlogs] = useState<BlogDetails[]>(() => homeCache?.blogs ?? [])
  const [blogAuthors, setBlogAuthors] = useState<Map<string, UserProfile>>(() => homeCache?.blogAuthors ?? new Map())
  const [loading, setLoading] = useState(() => !homeCache)

  useEffect(() => {
    let cancelled = false
    // Reuse cached home data on a quick return; only re-fetch when it's stale.
    if (homeCache && Date.now() - homeCache.at < HOME_TTL) { setLoading(false); return }
    async function load() {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      if (!homeCache) setLoading(true)
      try {
        const [modEvents, blogEvents, curationEvents] = await Promise.all([
          fetchEvents(relays, { kinds: [KINDS.MOD] }, 10000),
          fetchEvents(relays, { kinds: [KINDS.BLOG], authors: [ADMIN_PUBKEY] }, 8000),
          fetchEvents(relays, {
            kinds: [NIP78_KIND],
            authors: [ADMIN_PUBKEY],
            '#d': ['home-featured-mods-slider', 'home-featured-mods', 'home-featured-games'],
          }, 6000, 4500),
        ])
        if (cancelled) return

        const allMods = constructModListFromEvents(modEvents)
        setMods(allMods)

        // ── Admin curation (NIP-78): used when present, else derive ──
        // Keep the NEWEST event per d-tag — relays can return stale revisions of
        // a replaceable event, and last-write-wins would let an old copy clobber
        // the current selection purely by relay response order.
        const curationByD = new Map<string, NostrEvent>()
        for (const ev of curationEvents) {
          const d = ev.tags.find(t => t[0] === 'd')?.[1]
          if (!d) continue
          const prev = curationByD.get(d)
          if (!prev || ev.created_at > prev.created_at) curationByD.set(d, ev)
        }
        const curationTags = (d: string): string[][] => curationByD.get(d)?.tags ?? []
        const byATag = new Map(allMods.map(m => [m.aTag, m]))

        // normalizeModCoord repairs legacy coords stored with a doubled prefix
        // (30402:pk:30402:pk:uuid) so they match the real event's aTag/d tag.
        const sliderCoords = curationTags('home-featured-mods-slider')
          .filter(t => t[0] === 'a').map(t => normalizeModCoord(t[1]))
        const gridCoords = curationTags('home-featured-mods')
          .filter(t => t[0] === 'a').map(t => normalizeModCoord(t[1]))

        // Fetch any curated mods (slider + grid) not in the latest batch. Curation
        // may reference current (31142) OR legacy (30402) mods, so fetch both kinds.
        const wantedCoords = [...new Set([...sliderCoords, ...gridCoords])]
        const missing = wantedCoords.filter(a => !byATag.has(a))
        if (missing.length) {
          const authors = [...new Set(missing.map(a => a.split(':')[1]))]
          const dtags = [...new Set(missing.map(a => a.split(':').slice(2).join(':')))]
          const extraEvents = await fetchEvents(relays, { kinds: [KINDS.MOD, LEGACY_MOD_KIND], authors, '#d': dtags }, 6000)
          if (cancelled) return
          for (const m of constructModListFromEvents(extraEvents.filter(e => e.kind === KINDS.MOD))) byATag.set(m.aTag, m)
          for (const ev of extraEvents) {
            if (ev.kind === LEGACY_MOD_KIND && isLegacyModEvent(ev)) {
              const m = extractLegacyModData(ev)
              byATag.set(m.aTag, m)
            }
          }
        }
        const resolve = (coords: string[]) =>
          coords.map(a => byATag.get(a)).filter((m): m is ModDetails => !!m)

        const curatedSlider = resolve(sliderCoords)
        const sliderVal = curatedSlider.length ? curatedSlider : allMods.slice(0, 5)
        setSliderMods(sliderVal)
        const featuredVal = resolve(gridCoords)
        setFeaturedMods(featuredVal)

        const curatedGameNames = curationTags('home-featured-games')
          .filter(t => t[0] === 'game' || t[0] === 'g').map(t => t[1])
        const gameNames = curatedGameNames.length
          ? curatedGameNames
          : [...new Set(allMods.map(m => m.game).filter(Boolean))].slice(0, 6)
        const gamesVal = gameNames.map(name => ({ name, ...(getGameImages(name) ?? {}) }))
        setGames(gamesVal)

        // ── Blog posts ──
        const byKey = new Map<string, typeof blogEvents[0]>()
        for (const ev of blogEvents) {
          const d = ev.tags.find(t => t[0] === 'd')?.[1] ?? ''
          const key = `${ev.pubkey}:${d}`
          const existing = byKey.get(key)
          if (!existing || ev.created_at > existing.created_at) byKey.set(key, ev)
        }
        const parsedBlogs = Array.from(byKey.values())
          .map(extractBlogData)
          .filter(b => !b.isDeleted)
          .sort((a, b) => b.publishedAt - a.publishedAt)
          .slice(0, 2)
        setBlogs(parsedBlogs)

        const authors = new Map<string, UserProfile>()
        await Promise.allSettled([...new Set(parsedBlogs.map(b => b.pubkey))].map(async pk => {
          const p = await useUserStore.getState().fetchProfile(pk, relays)
          if (p) authors.set(pk, p)
        }))
        if (cancelled) return
        setBlogAuthors(authors)
        homeCache = {
          at: Date.now(),
          mods: allMods, sliderMods: sliderVal, featuredMods: featuredVal,
          games: gamesVal, blogs: parsedBlogs, blogAuthors: authors,
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [getGameImages])

  const moderate = useModerationFilter()
  const blockFilter = useBlockFilter()
  const wotFilter = useWotModFilter()
  const visible = (list: ModDetails[]) => wotFilter(blockFilter(moderate(list)))

  // Latest mods, excluding NSFW and admin-hidden/low-trust; best-effort fill up to 8.
  const latestMods = visible(mods.filter(m => !m.contentWarning)).slice(0, 8)
  const visibleSlider = visible(sliderMods)
  const visibleFeatured = visible(featuredMods)

  return (
    <div className="space-y-16">
      {/* Featured slider: full-bleed band, flush against the header */}
      {(loading || visibleSlider.length > 0) && (
        <div className="-mt-6 w-screen mx-[calc(50%_-_50vw)]">
          {loading ? (
            <Skeleton className="h-[320px] md:h-[440px] w-full rounded-none" />
          ) : (
            <FeaturedSlider mods={visibleSlider} />
          )}
        </div>
      )}

      {/* Featured Mods (admin-curated) */}
      {!loading && visibleFeatured.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white">Featured Mods</h2>
            <Link to="/mods" className="text-purple-400 hover:text-purple-300 text-sm font-medium flex items-center gap-1">
              View All <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* First 3: grid of 3 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {visibleFeatured.slice(0, 3).map(mod => (
              <ModCard key={mod.aTag} mod={mod} />
            ))}
          </div>

          {/* Next 4: grid of 4 */}
          {visibleFeatured.length > 3 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {visibleFeatured.slice(3, 7).map(mod => (
                <ModCard key={mod.aTag} mod={mod} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Featured Games */}
      {!loading && games.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Featured Games</h2>
            <Link to="/games" className="text-purple-400 hover:text-purple-300 text-sm font-medium flex items-center gap-1">
              All Games <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {games.map(game => (
              <GameCard key={game.name} game={game} />
            ))}
          </div>
        </section>
      )}

      {/* Latest Mods */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">Latest Mods</h2>
          <Link to="/mods" className="text-purple-400 hover:text-purple-300 text-sm font-medium flex items-center gap-1">
            View All <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-video w-full rounded-xl" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : latestMods.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {latestMods.map(mod => (
              <ModCard key={mod.aTag} mod={mod} />
            ))}
          </div>
        ) : (
          <p className="text-neutral-500 text-center py-12">
            No mods found yet. Be the first to publish!
          </p>
        )}
      </section>

      {/* From the Blog */}
      {!loading && blogs.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="flex items-center gap-2 text-2xl font-bold text-white">
              <BookOpen className="h-6 w-6 text-purple-400" />
              From the Blog
            </h2>
            <Link to="/blog" className="text-purple-400 hover:text-purple-300 text-sm font-medium flex items-center gap-1">
              View All <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            {blogs.map(blog => (
              <div key={blog.id} className="flex-1 min-w-0">
                <BlogPostCard blog={blog} author={blogAuthors.get(blog.pubkey)} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
