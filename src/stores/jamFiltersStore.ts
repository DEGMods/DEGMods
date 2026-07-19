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

export interface JamFiltersState {
  nsfwMode: NsfwMode
  status: JamStatusFilter
  /** Month range ("YYYY-MM", '' = unset). Drives the relay-side `y` filter. */
  fromMonth: string
  toMonth: string
  sources: SourceEntry[]
  searchTags: string[]
  excludedTags: string[]
  /** True once the user has manually edited the excluded tags. While false, the
   *  list tracks the admin moderation defaults (NIP-78). */
  excludedTagsTouched: boolean

  setNsfwMode: (m: NsfwMode) => void
  setStatus: (s: JamStatusFilter) => void
  setRange: (from: string, to: string) => void
  setSources: (s: SourceEntry[]) => void
  setSearchTags: (t: string[]) => void
  setExcludedTags: (t: string[]) => void
  /** Reset to the given moderation defaults and clear the touched flag. */
  resetExcludedTags: (defaults: string[]) => void
  /** Apply moderation defaults, but only if the user hasn't customized. */
  applyExcludedTagsDefaults: (defaults: string[]) => void
}

/**
 * One filter store per listing, same shape.
 *
 * A jam's submissions are filtered independently of the jam listing itself —
 * narrowing entries inside one jam shouldn't quietly reshape /mod-jams — but the
 * controls are identical, so the state is too. The submissions listing simply
 * doesn't render the status and range controls (see `JamFiltersBar`), leaving
 * those fields inert there.
 */
function createFiltersStore(persistKey: string) {
  return create<JamFiltersState>()(
    persist(
      (set, get) => ({
        nsfwMode: 'hide',
        status: 'all',
        fromMonth: '',
        toMonth: '',
        sources: DEFAULT_SOURCES,
        searchTags: [],
        excludedTags: DEFAULT_EXCLUDED_TAGS,
        excludedTagsTouched: false,

        setNsfwMode: (nsfwMode) => set({ nsfwMode }),
        setStatus: (status) => set({ status }),
        setRange: (fromMonth, toMonth) => set({ fromMonth, toMonth }),
        setSources: (sources) => set({ sources }),
        setSearchTags: (searchTags) => set({ searchTags }),
        setExcludedTags: (excludedTags) => set({ excludedTags, excludedTagsTouched: true }),
        resetExcludedTags: (defaults) => set({ excludedTags: defaults, excludedTagsTouched: false }),
        applyExcludedTagsDefaults: (defaults) => {
          if (!get().excludedTagsTouched) set({ excludedTags: defaults })
        },
      }),
      { name: persistKey },
    ),
  )
}

export const useJamFiltersStore = createFiltersStore('deg-mods:jam-filters')

/** Filters for the entries inside one jam (`/mod-jam/:naddr/submissions`). */
export const useSubmissionFiltersStore = createFiltersStore('deg-mods:submission-filters')

/**
 * A filter store as consumed by the shared bar. Declared as a plain callable
 * rather than `typeof useJamFiltersStore` — the bound-store type's overloads
 * defeat inference when it arrives as a prop, leaving the destructured state
 * implicitly `any`.
 */
export type FiltersStore = () => JamFiltersState
