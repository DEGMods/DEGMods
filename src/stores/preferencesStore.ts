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

  setRenderImages: (v: boolean) => void
  setRenderVideos: (v: boolean) => void
  setRenderAudio: (v: boolean) => void
  setRenderHyperlinks: (v: boolean) => void
  setSoftModeration: (v: boolean) => void
  setHardModeration: (v: boolean) => void
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

      setRenderImages: (renderImages) => set({ renderImages }),
      setRenderVideos: (renderVideos) => set({ renderVideos }),
      setRenderAudio: (renderAudio) => set({ renderAudio }),
      setRenderHyperlinks: (renderHyperlinks) => set({ renderHyperlinks }),
      setSoftModeration: (softModeration) => set({ softModeration }),
      setHardModeration: (hardModeration) => set({ hardModeration }),
    }),
    { name: 'deg-mods:preferences' },
  ),
)
