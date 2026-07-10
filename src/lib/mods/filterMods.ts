import { countLeadingZeroBits } from '@/lib/pow/pow'
import { UNTAGGED, type NsfwMode, type RepostMode, type EmulationMode, type LegacyMode, type SourceEntry } from '@/stores/modFiltersStore'
import type { ModDetails } from '@/types/mod'

export interface ModFilterState {
  nsfwMode: NsfwMode
  minPow: number
  sources: SourceEntry[]
  searchTags: string[]
  excludedTags: string[]
  categoryFilters: string[]
  repostMode: RepostMode
  emulationMode: EmulationMode
  legacyMode: LegacyMode // LEGACY: old kind-30402 mod visibility
  /** Authors exempt from the PoW filter (people you follow + yourself). */
  powExempt?: Set<string>
}

/**
 * Apply the shared mod-listing filters (NSFW, PoW, sources, tags, excluded
 * tags, category chains). Used by both /mods and /game/:name.
 */
export function applyModFilters(mods: ModDetails[], f: ModFilterState): ModDetails[] {
  let result = mods

  if (f.nsfwMode === 'hide') result = result.filter(m => !m.contentWarning)
  else if (f.nsfwMode === 'only') result = result.filter(m => !!m.contentWarning)

  if (f.repostMode === 'originals') result = result.filter(m => !m.isRepost)
  else if (f.repostMode === 'only') result = result.filter(m => m.isRepost)

  if (f.emulationMode === 'native') result = result.filter(m => !m.emulation)
  else if (f.emulationMode === 'only') result = result.filter(m => m.emulation)

  // LEGACY: old kind-30402 mod visibility
  if (f.legacyMode === 'hide') result = result.filter(m => !m.legacy)
  else if (f.legacyMode === 'only') result = result.filter(m => m.legacy)

  // Legacy mods predate PoW and are exempt from the PoW filter.
  if (f.minPow > 0) result = result.filter(m => m.legacy || f.powExempt?.has(m.pubkey) || countLeadingZeroBits(m.id) >= f.minPow)

  // Legacy mods predate the client-source tag, so they bypass the Sources filter
  // (otherwise they'd all count as "untagged" and vanish when that source is off).
  const disabledSources = new Set(f.sources.filter(s => !s.enabled).map(s => s.name.toLowerCase()))
  if (disabledSources.size > 0) {
    result = result.filter(m => m.legacy || !disabledSources.has((m.client || UNTAGGED).toLowerCase()))
  }

  if (f.searchTags.length > 0) {
    const wanted = f.searchTags.map(t => t.toLowerCase())
    result = result.filter(m => m.tags.some(t => wanted.includes(t.toLowerCase())))
  }

  if (f.excludedTags.length > 0) {
    const banned = new Set(f.excludedTags.map(t => t.toLowerCase()))
    result = result.filter(m => !m.tags.some(t => banned.has(t.toLowerCase())))
  }

  const wantedCats = f.categoryFilters
    .map(c => c.split(':').filter(Boolean).join(':'))
    .filter(Boolean)
  if (wantedCats.length > 0) {
    result = result.filter(m =>
      m.categories.some(mc => wantedCats.some(w => mc === w || mc.startsWith(w + ':'))),
    )
  }

  return result
}
