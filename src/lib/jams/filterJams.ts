import { countLeadingZeroBits } from '@/lib/pow/pow'
import { UNTAGGED, type NsfwMode, type SourceEntry } from '@/stores/modFiltersStore'
import type { JamStatusFilter } from '@/stores/jamFiltersStore'
import { jamStatus, type JamDetails } from '@/lib/nostr/jam'

export interface JamFilterState {
  nsfwMode: NsfwMode
  status: JamStatusFilter
  minPow: number
  sources: SourceEntry[]
  searchTags: string[]
  excludedTags: string[]
  /** Authors exempt from the PoW filter (people you follow + yourself). */
  powExempt?: Set<string>
  /** Current unix time — status is derived, not stored on the event. */
  now: number
}

/**
 * Apply the shared jam-listing filters (status, NSFW, PoW, sources, tags,
 * excluded tags). Mirrors applyModFilters for the mod listings.
 */
export function applyJamFilters(jams: JamDetails[], f: JamFilterState): JamDetails[] {
  let result = jams

  if (f.status !== 'all') result = result.filter((j) => jamStatus(j, f.now) === f.status)

  if (f.nsfwMode === 'hide') result = result.filter((j) => !j.contentWarning)
  else if (f.nsfwMode === 'only') result = result.filter((j) => !!j.contentWarning)

  if (f.minPow > 0) {
    result = result.filter((j) => f.powExempt?.has(j.pubkey) || countLeadingZeroBits(j.id) >= f.minPow)
  }

  const disabledSources = new Set(f.sources.filter((s) => !s.enabled).map((s) => s.name.toLowerCase()))
  if (disabledSources.size > 0) {
    result = result.filter((j) => !disabledSources.has((j.client || UNTAGGED).toLowerCase()))
  }

  if (f.searchTags.length > 0) {
    const wanted = f.searchTags.map((t) => t.toLowerCase())
    result = result.filter((j) => j.tags.some((t) => wanted.includes(t.toLowerCase())))
  }

  if (f.excludedTags.length > 0) {
    const banned = new Set(f.excludedTags.map((t) => t.toLowerCase()))
    result = result.filter((j) => !j.tags.some((t) => banned.has(t.toLowerCase())))
  }

  return result
}
