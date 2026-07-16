/**
 * Mod-jam listing filters: persisted to localStorage so they survive restarts.
 *
 * Deliberately separate from the mod-listing filters (`modFiltersStore`): the two
 * listings have different tag vocabularies, so a filter set on /mods shouldn't
 * silently reshape /mod-jams. PoW (settingsStore) and Web of Trust (wotStore) are
 * global and shared by both.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_EXCLUDED_TAGS } from '@/lib/constants'
import { type NsfwMode, type SourceEntry, UNTAGGED } from '@/stores/modFiltersStore'

export type JamStatusFilter = 'all' | 'active' | 'upcoming' | 'voting' | 'ended'

const DEFAULT_SOURCES: SourceEntry[] = [
  { name: 'DEG MODS', enabled: true },
  { name: 'DEG MODS Network', enabled: true },
  { name: UNTAGGED, enabled: false },
]

interface JamFiltersState {
  nsfwMode: NsfwMode
  status: JamStatusFilter
  sources: SourceEntry[]
  searchTags: string[]
  excludedTags: string[]
  /** True once the user has manually edited the excluded tags. While false, the
   *  list tracks the admin moderation defaults (NIP-78). */
  excludedTagsTouched: boolean

  setNsfwMode: (m: NsfwMode) => void
  setStatus: (s: JamStatusFilter) => void
  setSources: (s: SourceEntry[]) => void
  setSearchTags: (t: string[]) => void
  setExcludedTags: (t: string[]) => void
  /** Reset to the given moderation defaults and clear the touched flag. */
  resetExcludedTags: (defaults: string[]) => void
  /** Apply moderation defaults, but only if the user hasn't customized. */
  applyExcludedTagsDefaults: (defaults: string[]) => void
}

export const useJamFiltersStore = create<JamFiltersState>()(
  persist(
    (set, get) => ({
      nsfwMode: 'hide',
      status: 'all',
      sources: DEFAULT_SOURCES,
      searchTags: [],
      excludedTags: DEFAULT_EXCLUDED_TAGS,
      excludedTagsTouched: false,

      setNsfwMode: (nsfwMode) => set({ nsfwMode }),
      setStatus: (status) => set({ status }),
      setSources: (sources) => set({ sources }),
      setSearchTags: (searchTags) => set({ searchTags }),
      setExcludedTags: (excludedTags) => set({ excludedTags, excludedTagsTouched: true }),
      resetExcludedTags: (defaults) => set({ excludedTags: defaults, excludedTagsTouched: false }),
      applyExcludedTagsDefaults: (defaults) => {
        if (!get().excludedTagsTouched) set({ excludedTags: defaults })
      },
    }),
    { name: 'deg-mods:jam-filters' },
  ),
)
