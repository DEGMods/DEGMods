/**
 * User preferences: comment rendering + moderation opt-outs.
 *
 * Comment rendering defaults to text-only (no clickable links or embedded
 * media); each media type can be enabled individually. Moderation is on by
 * default — users may disable the admins' hiding ("soft") or render-blocking
 * ("hard") at their own risk.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PreferencesState {
  // ── Comment rendering (all off by default) ──
  renderImages: boolean
  renderVideos: boolean
  renderAudio: boolean
  renderHyperlinks: boolean

  // ── Moderation opt-outs (on by default) ──
  softModeration: boolean
  hardModeration: boolean

  /**
   * Show content-warned media without the click-to-reveal step.
   *
   * Off by default: someone who hasn't asked for it shouldn't get explicit
   * media rendered at them. This only removes the *cover* — it doesn't change
   * which posts are listed, which is the separate NSFW filter on each listing.
   */
  showNsfwMedia: boolean

  setRenderImages: (v: boolean) => void
  setRenderVideos: (v: boolean) => void
  setRenderAudio: (v: boolean) => void
  setRenderHyperlinks: (v: boolean) => void
  setSoftModeration: (v: boolean) => void
  setHardModeration: (v: boolean) => void
  setShowNsfwMedia: (v: boolean) => void
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      renderImages: false,
      renderVideos: false,
      renderAudio: false,
      renderHyperlinks: false,

      softModeration: true,
      hardModeration: true,
      showNsfwMedia: false,

      setRenderImages: (renderImages) => set({ renderImages }),
      setRenderVideos: (renderVideos) => set({ renderVideos }),
      setRenderAudio: (renderAudio) => set({ renderAudio }),
      setRenderHyperlinks: (renderHyperlinks) => set({ renderHyperlinks }),
      setSoftModeration: (softModeration) => set({ softModeration }),
      setHardModeration: (hardModeration) => set({ hardModeration }),
      setShowNsfwMedia: (showNsfwMedia) => set({ showNsfwMedia }),
    }),
    { name: 'deg-mods:preferences' },
  ),
)
