import { useEffect } from 'react'
import { useModerationTagsStore } from '@/stores/moderationTagsStore'
import type { ModerationOverlay } from '@/lib/nostr/moderationTags'
import type { ModDetails } from '@/types/mod'

/**
 * The admin's tag overlay for one target, requesting it if it isn't known yet.
 *
 * `checked` reports whether the answer has settled — either a real result or a
 * fail-open. Rendering that could expose something (an image) should wait on it;
 * rendering that can't (a badge) shouldn't.
 */
export function useModerationOverlay(key: string | undefined): {
  overlay: ModerationOverlay | null
  checked: boolean
} {
  const overlay = useModerationTagsStore((s) => (key ? s.overlays[key] : undefined))
  const checked = useModerationTagsStore(
    (s) => (key ? key in s.overlays || !!s.resolved[key] : true),
  )

  useEffect(() => {
    if (key) useModerationTagsStore.getState().ensure([key])
  }, [key])

  return { overlay: overlay ?? null, checked }
}

export interface EffectiveModFlags {
  contentWarning?: string
  isRepost: boolean
  originalAuthor?: string
  /** False while the admin overlay is still unknown. */
  checked: boolean
}

/**
 * A mod's flags with the admin's overlay merged in.
 *
 * Additive on purpose: the admin *adds* what an author left off, and never
 * clears what the author set themselves. So a post the author marked NSFW stays
 * NSFW no matter what the overlay says or whether it ever loads — which is why
 * failing open here is survivable.
 */
export function useEffectiveModFlags(mod: ModDetails): EffectiveModFlags {
  const { overlay, checked } = useModerationOverlay(mod.aTag)
  return {
    contentWarning: mod.contentWarning || overlay?.contentWarning,
    isRepost: mod.isRepost || !!overlay?.isRepost,
    originalAuthor: mod.originalAuthor || overlay?.originalAuthor,
    checked,
  }
}
