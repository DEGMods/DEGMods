import { useMemo } from 'react'
import { useWotStore } from '@/stores/wotStore'

/**
 * Returns a filter that removes posts authored by low-trust users (per the
 * user's Web of Trust), when WoT is applied to mods. Direct follows bypass it.
 * Works on anything carrying an author pubkey (mods, jams, …).
 */
export function useWotModFilter(): <T extends { pubkey: string }>(items: T[]) => T[] {
  const applyMods = useWotStore((s) => s.settings.applyMods)
  const threshold = useWotStore((s) => s.settings.scoreThreshold)
  const depth = useWotStore((s) => s.settings.followDepth)
  const dnnBonus = useWotStore((s) => s.settings.dnnBonus)
  const lastUpdated = useWotStore((s) => s.lastUpdated)

  return useMemo(() => {
    if (!applyMods) return <T extends { pubkey: string }>(items: T[]) => items
    const shouldHide = useWotStore.getState().shouldHide
    return <T extends { pubkey: string }>(items: T[]) => items.filter((m) => !shouldHide(m.pubkey, 'mods'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyMods, threshold, depth, dnnBonus, lastUpdated])
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
