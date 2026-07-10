import { useMemo } from 'react'
import { useWotStore } from '@/stores/wotStore'
import type { ModDetails } from '@/types/mod'

/**
 * Returns a filter that removes mods authored by low-trust users (per the
 * user's Web of Trust), when WoT is applied to mods. Direct follows bypass it.
 */
export function useWotModFilter(): (mods: ModDetails[]) => ModDetails[] {
  const applyMods = useWotStore((s) => s.settings.applyMods)
  const threshold = useWotStore((s) => s.settings.scoreThreshold)
  const depth = useWotStore((s) => s.settings.followDepth)
  const dnnBonus = useWotStore((s) => s.settings.dnnBonus)
  const lastUpdated = useWotStore((s) => s.lastUpdated)

  return useMemo(() => {
    if (!applyMods) return (mods) => mods
    const shouldHide = useWotStore.getState().shouldHide
    return (mods) => mods.filter((m) => !shouldHide(m.pubkey, 'mods'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyMods, threshold, depth, dnnBonus, lastUpdated])
}

/** How many of these mods are low-trust (would be / are hidden by WoT). */
export function useWotHiddenCount(mods: ModDetails[]): number {
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
