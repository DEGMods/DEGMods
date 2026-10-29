/**
 * The landing page's cached data (localStorage-backed).
 *
 * Lives in its own module, not in HomePage, so other places can invalidate it
 * without importing the page. In particular, deleting a mod purges it here the
 * same way it already purges the event cache and the mod-list caches — otherwise
 * the deleted mod keeps painting in "Latest Mods" from this snapshot until it
 * ages out and a background revalidation happens to land.
 */
import type { ModDetails } from '@/types/mod'
import type { GameEntry } from '@/types/game'
import type { BlogDetails } from '@/types/blog'
import type { UserProfile } from '@/stores/userStore'
import type { FeaturedBanner as BannerData, AdEntry } from '@/lib/nostr/events'
import type { HubRec } from '@/lib/nostr/hubs'

export const HOME_CACHE_KEY = 'home-cache-v2'

// Home data survives navigation AND full reloads (persisted to localStorage) so
// returning is instant instead of re-fetching everything and flashing skeletons.
// A stale cache still paints immediately, then refreshes in the background.
export interface HomeCache {
  at: number
  mods: ModDetails[]
  sliderMods: ModDetails[]
  featuredMods: ModDetails[]
  games: GameEntry[]
  blogs: BlogDetails[]
  blogAuthors: Map<string, UserProfile>
  banner: BannerData | null
  ads: AdEntry[]
  /** Recommended-hub coordinates (resolved to hub cards client-side). Optional so
   *  pre-existing cached blobs without it still load. */
  hubRecs?: HubRec[]
}

let homeCache: HomeCache | null = null

/** The current in-memory cache, if read this session (does not touch storage). */
export function peekHomeCache(): HomeCache | null {
  return homeCache
}

// Read the cache once (in-memory first, else the sync localStorage copy). Sync so
// the very first render can paint from it with no skeleton flash on reload.
export function readHomeCache(): HomeCache | null {
  if (homeCache) return homeCache
  try {
    const raw = localStorage.getItem(HOME_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Omit<HomeCache, 'blogAuthors'> & { blogAuthors: [string, UserProfile][] }
    homeCache = { ...parsed, blogAuthors: new Map(parsed.blogAuthors) }
    return homeCache
  } catch {
    return null
  }
}

export function writeHomeCache(cache: HomeCache): void {
  homeCache = cache
  try {
    localStorage.setItem(
      HOME_CACHE_KEY,
      JSON.stringify({ ...cache, blogAuthors: [...cache.blogAuthors] }),
    )
  } catch {
    // quota / serialization failure is non-fatal — the in-memory copy still serves.
  }
}

/**
 * Drop a mod coordinate from the cached lists after it's deleted, so the landing
 * page stops showing it immediately instead of waiting for the cache to expire.
 *
 * Matched on pubkey + d-tag rather than the full aTag, so it catches the mod
 * whether it's a current (31142) or legacy (30402) coordinate. Both the
 * in-memory copy and the persisted one are updated.
 */
export function purgeHomeCache(pubkey: string, dTag: string): void {
  const cache = readHomeCache()
  if (!cache) return
  const keep = (m: ModDetails) => !(m.pubkey === pubkey && m.dTag === dTag)
  const mods = cache.mods.filter(keep)
  const sliderMods = cache.sliderMods.filter(keep)
  const featuredMods = cache.featuredMods.filter(keep)
  if (
    mods.length === cache.mods.length &&
    sliderMods.length === cache.sliderMods.length &&
    featuredMods.length === cache.featuredMods.length
  ) return // nothing to remove
  writeHomeCache({ ...cache, mods, sliderMods, featuredMods })
}
