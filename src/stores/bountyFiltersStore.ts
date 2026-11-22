/**
 * Mod-request (bounty) listing filters, persisted to localStorage. Mirrors
 * jamFiltersStore. PoW (settingsStore) and Web of Trust (wotStore) are global and
 * shared with the mod/jam listings; this store holds only the per-listing bits.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_EXCLUDED_TAGS } from '@/lib/constants'
import { type NsfwMode, type SourceEntry, UNTAGGED } from '@/stores/modFiltersStore'

export type BountyStatusFilter = 'all' | 'open' | 'fulfilled'

const DEFAULT_SOURCES: SourceEntry[] = [
  { name: 'DEG MODS', enabled: true },
  { name: 'DEG MODS Network', enabled: true },
  { name: UNTAGGED, enabled: false },
]

export interface BountyFiltersState {
  nsfwMode: NsfwMode
  status: BountyStatusFilter
  /** Single game to filter to ('' = all games). */
  game: string
  sources: SourceEntry[]
  searchTags: string[]
  excludedTags: string[]
  excludedTagsTouched: boolean

  setNsfwMode: (m: NsfwMode) => void
  setStatus: (s: BountyStatusFilter) => void
  setGame: (g: string) => void
  setSources: (s: SourceEntry[]) => void
  setSearchTags: (t: string[]) => void
  setExcludedTags: (t: string[]) => void
  resetExcludedTags: (defaults: string[]) => void
  applyExcludedTagsDefaults: (defaults: string[]) => void
}

export const useBountyFiltersStore = create<BountyFiltersState>()(
  persist(
    (set, get) => ({
      nsfwMode: 'hide',
      status: 'all',
      game: '',
      sources: DEFAULT_SOURCES,
      searchTags: [],
      excludedTags: DEFAULT_EXCLUDED_TAGS,
      excludedTagsTouched: false,

      setNsfwMode: (nsfwMode) => set({ nsfwMode }),
      setStatus: (status) => set({ status }),
      setGame: (game) => set({ game }),
      setSources: (sources) => set({ sources }),
      setSearchTags: (searchTags) => set({ searchTags }),
      setExcludedTags: (excludedTags) => set({ excludedTags, excludedTagsTouched: true }),
      resetExcludedTags: (defaults) => set({ excludedTags: defaults, excludedTagsTouched: false }),
      applyExcludedTagsDefaults: (defaults) => {
        if (!get().excludedTagsTouched) set({ excludedTags: defaults })
      },
    }),
    { name: 'deg-mods:bounty-filters' },
  ),
)
