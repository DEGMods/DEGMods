/**
 * Mod listing filters: persisted to localStorage so they survive restarts.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_EXCLUDED_TAGS } from '@/lib/constants'

export type NsfwMode = 'hide' | 'show' | 'only'
export type RepostMode = 'originals' | 'show' | 'only'
export type EmulationMode = 'native' | 'show' | 'only'
export type LegacyMode = 'hide' | 'show' | 'only' // LEGACY: old kind-30402 mods

export interface SourceEntry {
  /** Client name, or the special value `untagged` for mods without a client tag. */
  name: string
  enabled: boolean
}

export const UNTAGGED = 'untagged'
export const DEFAULT_MIN_POW = 15

/** Built-in client sources (always present, not removable). */
export const BUILTIN_SOURCES = ['DEG MODS', 'DEG MODS Network']

const DEFAULT_SOURCES: SourceEntry[] = [
  { name: 'DEG MODS', enabled: true },
  { name: 'DEG MODS Network', enabled: true },
  { name: UNTAGGED, enabled: false },
]

interface ModFiltersState {
  nsfwMode: NsfwMode
  sources: SourceEntry[]
  searchTags: string[]
  excludedTags: string[]
  /** True once the user has manually edited the excluded tags. While false, the
   *  list tracks the admin moderation defaults (NIP-78). */
  excludedTagsTouched: boolean
  /** Category chains ("a:b:c") to filter by. */
  categoryFilters: string[]
  /** Repost visibility: originals only / show all / only reposts. */
  repostMode: RepostMode
  /** Emulated-game visibility: native only / show all / only emulated. */
  emulationMode: EmulationMode
  /** LEGACY: old kind-30402 mod visibility — hide / show all / only legacy. */
  legacyMode: LegacyMode

  setNsfwMode: (m: NsfwMode) => void
  setRepostMode: (m: RepostMode) => void
  setEmulationMode: (m: EmulationMode) => void
  setLegacyMode: (m: LegacyMode) => void
  setSources: (s: SourceEntry[]) => void
  setSearchTags: (t: string[]) => void
  setExcludedTags: (t: string[]) => void
  setCategoryFilters: (c: string[]) => void
  /** Reset to the given moderation defaults and clear the touched flag. */
  resetExcludedTags: (defaults: string[]) => void
  /** Apply moderation defaults, but only if the user hasn't customized. */
  applyExcludedTagsDefaults: (defaults: string[]) => void
}

/**
 * One independent set of mod filters, persisted under its own key.
 *
 * Separate instances rather than one shared store so narrowing a profile's mods
 * doesn't reshape /mods — the same reason jam submissions have their own
 * (see jamFiltersStore). The cost is that a preference like "show NSFW" has to
 * be set per listing; that's deliberate, since the alternative is a filter
 * silently following you between pages that show different things.
 */
function createModFiltersStore(persistKey: string) {
  return create<ModFiltersState>()(
  persist(
    (set, get) => ({
      nsfwMode: 'hide',
      sources: DEFAULT_SOURCES,
      searchTags: [],
      excludedTags: DEFAULT_EXCLUDED_TAGS,
      excludedTagsTouched: false,
      categoryFilters: [],
      repostMode: 'show',
      emulationMode: 'show',
      legacyMode: 'show', // LEGACY: show old mods by default (tagged)

      setNsfwMode: (nsfwMode) => set({ nsfwMode }),
      setRepostMode: (repostMode) => set({ repostMode }),
      setEmulationMode: (emulationMode) => set({ emulationMode }),
      setLegacyMode: (legacyMode) => set({ legacyMode }), // LEGACY
      setSources: (sources) => set({ sources }),
      setSearchTags: (searchTags) => set({ searchTags }),
      setExcludedTags: (excludedTags) => set({ excludedTags, excludedTagsTouched: true }),
      setCategoryFilters: (categoryFilters) => set({ categoryFilters }),
      resetExcludedTags: (defaults) => set({ excludedTags: defaults, excludedTagsTouched: false }),
      applyExcludedTagsDefaults: (defaults) => {
        if (!get().excludedTagsTouched) set({ excludedTags: defaults })
      },
    }),
    { name: persistKey },
  ),
  )
}

export const useModFiltersStore = createModFiltersStore('deg-mods:mod-filters')

/** Filters for the mods on one author's profile (`/profile/:npub?tab=mods`). */
export const useProfileModFiltersStore = createModFiltersStore('deg-mods:profile-mod-filters')

/**
 * A filter store as consumed by the shared bar. A plain callable rather than
 * `typeof useModFiltersStore` — the bound-store type's overloads defeat
 * inference when it arrives as a prop, leaving the destructured state `any`.
 */
export type ModFiltersStore = () => ModFiltersState
