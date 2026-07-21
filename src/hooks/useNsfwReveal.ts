import { useState } from 'react'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * Whether content-warned media on this post should be shown uncovered.
 *
 * Two ways to get there: the reader clicked to reveal this one, or they've
 * turned on "show NSFW media" in preferences and don't want to be asked at all.
 * Every cover in the app goes through this so the preference can't apply in some
 * places and not others.
 *
 * `reveal()` is per-post and deliberately one-way — nothing re-covers media the
 * reader chose to look at.
 */
export function useNsfwReveal(): { revealed: boolean; reveal: () => void } {
  const showNsfwMedia = usePreferencesStore((s) => s.showNsfwMedia)
  const [clicked, setClicked] = useState(false)
  return {
    revealed: showNsfwMedia || clicked,
    reveal: () => setClicked(true),
  }
}
