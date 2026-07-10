import { useMemo } from 'react'
import { useModerationStore } from '@/stores/moderationStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useAuthStore } from '@/stores/authStore'
import type { ModDetails } from '@/types/mod'

/**
 * Returns a filter that removes admin-hidden mods (blocked mods + blocked
 * users) from discovery surfaces, unless the user has disabled soft moderation.
 *
 * Authors are always exempt for their own mods: a blocked author still sees
 * their post in discovery (with the warning pill) so moderation doesn't bait
 * them into reposting / ban-evading. Everyone else gets the hidden behavior.
 */
export function useModerationFilter(): (mods: ModDetails[]) => ModDetails[] {
  const blockedMods = useModerationStore((s) => s.blockedMods)
  const blockedUsers = useModerationStore((s) => s.blockedUsers)
  const softOn = usePreferencesStore((s) => s.softModeration)
  const myPubkey = useAuthStore((s) => s.pubkey)

  return useMemo(() => {
    if (!softOn) return (mods) => mods
    const coords = new Set(blockedMods.map((b) => b.coord))
    const users = new Set(blockedUsers)
    return (mods) => mods.filter((m) =>
      m.pubkey === myPubkey || (!coords.has(m.aTag) && !users.has(m.pubkey))
    )
  }, [blockedMods, blockedUsers, softOn, myPubkey])
}

export interface ModStatus {
  /** In a blocklist (blocked mod or blocked user). Independent of opt-outs —
   *  the warning/badge always shows, even when moderation is toggled off. */
  moderated: boolean
  /** Render-blocked — don't render the mod at all (hard moderation on). */
  blockRender: boolean
}

/** Moderation status for a single mod, honoring the user's opt-outs. */
export function useModStatus(aTag?: string, pubkey?: string): ModStatus {
  const blockedMods = useModerationStore((s) => s.blockedMods)
  const blockedUsers = useModerationStore((s) => s.blockedUsers)
  const hardOn = usePreferencesStore((s) => s.hardModeration)
  const myPubkey = useAuthStore((s) => s.pubkey)

  return useMemo(() => {
    const entry = aTag ? blockedMods.find((b) => b.coord === aTag) : undefined
    const userBlocked = pubkey ? blockedUsers.includes(pubkey) : false
    // The author can always view their own post (even hard-blocked), but the
    // warning pill still shows — moderated stays true regardless of authorship.
    const isAuthor = !!pubkey && pubkey === myPubkey
    return {
      moderated: !!entry || userBlocked,
      blockRender: !isAuthor && !!entry?.viewBlocked && hardOn,
    }
  }, [aTag, pubkey, blockedMods, blockedUsers, hardOn, myPubkey])
}
