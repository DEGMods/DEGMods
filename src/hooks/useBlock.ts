import { useMemo } from 'react'
import { useBlockStore } from '@/stores/blockStore'
import type { ModDetails } from '@/types/mod'

/**
 * Removes mods authored by users you've blocked (your personal mute list).
 * Always applies — blocking is an explicit, personal action.
 */
export function useBlockFilter(): (mods: ModDetails[]) => ModDetails[] {
  const blocked = useBlockStore((s) => s.blockedPubkeys)
  return useMemo(
    () => (mods) => (blocked.size ? mods.filter((m) => !blocked.has(m.pubkey)) : mods),
    [blocked],
  )
}
