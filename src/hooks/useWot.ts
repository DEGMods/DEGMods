import { useMemo } from 'react'
import { useWotStore, type WotContext } from '@/stores/wotStore'

/**
 * Returns a filter that removes posts authored by low-trust users (per the
 * user's Web of Trust) for the given surface. Direct follows bypass it. Works
 * on anything carrying an author pubkey.
 */
function useWotFilterFor(context: WotContext, applied: boolean) {
  const threshold = useWotStore((s) => s.settings.scoreThreshold)
  const depth = useWotStore((s) => s.settings.followDepth)
  const dnnBonus = useWotStore((s) => s.settings.dnnBonus)
  const lastUpdated = useWotStore((s) => s.lastUpdated)

  return useMemo(() => {
    if (!applied) return <T extends { pubkey: string }>(items: T[]) => items
    const shouldHide = useWotStore.getState().shouldHide
    return <T extends { pubkey: string }>(items: T[]) => items.filter((m) => !shouldHide(m.pubkey, context))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, applied, threshold, depth, dnnBonus, lastUpdated])
}

/** WoT filter for mod listings, search and discovery. */
export function useWotModFilter(): <T extends { pubkey: string }>(items: T[]) => T[] {
  return useWotFilterFor('mods', useWotStore((s) => s.settings.applyMods))
}

/**
 * WoT filter for mod jam listings.
 *
 * Jams were previously filtered through the mods switch, which meant turning
 * mods off silently turned jams off too and there was no way to set them
 * differently. They're their own surface now.
 */
export function useWotJamFilter(): <T extends { pubkey: string }>(items: T[]) => T[] {
  return useWotFilterFor('jams', useWotStore((s) => s.settings.applyJams))
}

/** How many of these posts are low-trust (would be / are hidden by WoT). */
export function useWotHiddenCount(mods: { pubkey: string }[]): number {
  const threshold = useWotStore((s) => s.settings.scoreThreshold)
  const depth = useWotStore((s) => s.settings.followDepth)
  const dnnBonus = useWotStore((s) => s.settings.dnnBonus)
  const lastUpdated = useWotStore((s) => s.lastUpdated)

  return useMemo(() => {
    const isLowTrust = useWotStore.getState().isLowTrust
    let n = 0
    for (const m of mods) if (isLowTrust(m.pubkey)) n++
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mods, threshold, depth, dnnBonus, lastUpdated])
}
