import { countLeadingZeroBits } from '@/lib/pow/pow'
import { UNTAGGED, type NsfwMode, type SourceEntry } from '@/stores/modFiltersStore'
import type { BountyStatusFilter } from '@/stores/bountyFiltersStore'
import type { BountyDetails } from '@/lib/nostr/bounty'

export interface BountyFilterState {
  nsfwMode: NsfwMode
  status: BountyStatusFilter
  game: string
  minPow: number
  sources: SourceEntry[]
  searchTags: string[]
  excludedTags: string[]
  /** Authors exempt from the PoW filter (people you follow + yourself). */
  powExempt?: Set<string>
}

/**
 * Apply the shared mod-request listing filters (status, game, NSFW, PoW, sources,
 * tags, excluded tags). Mirrors applyJamFilters / applyModFilters.
 */
export function applyBountyFilters(bounties: BountyDetails[], f: BountyFilterState): BountyDetails[] {
  let result = bounties

  if (f.status !== 'all') result = result.filter((b) => (f.status === 'fulfilled' ? b.fulfilled : !b.fulfilled))

  if (f.game.trim()) result = result.filter((b) => b.game === f.game)

  if (f.nsfwMode === 'hide') result = result.filter((b) => !b.contentWarning)
  else if (f.nsfwMode === 'only') result = result.filter((b) => !!b.contentWarning)

  if (f.minPow > 0) {
    result = result.filter((b) => f.powExempt?.has(b.pubkey) || countLeadingZeroBits(b.id) >= f.minPow)
  }

  const disabledSources = new Set(f.sources.filter((s) => !s.enabled).map((s) => s.name.toLowerCase()))
  if (disabledSources.size > 0) {
    result = result.filter((b) => !disabledSources.has((b.client || UNTAGGED).toLowerCase()))
  }

  if (f.searchTags.length > 0) {
    const wanted = f.searchTags.map((t) => t.toLowerCase())
    result = result.filter((b) => b.tags.some((t) => wanted.includes(t.toLowerCase())))
  }

  if (f.excludedTags.length > 0) {
    const banned = new Set(f.excludedTags.map((t) => t.toLowerCase()))
    result = result.filter((b) => !b.tags.some((t) => banned.has(t.toLowerCase())))
  }

  return result
}
