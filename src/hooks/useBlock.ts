import { useMemo } from 'react'
import { useBlockStore } from '@/stores/blockStore'

/**
 * Removes posts authored by users you've blocked (your personal mute list).
 * Always applies — blocking is an explicit, personal action. Works on anything
 * carrying an author pubkey (mods, jams, …).
 */
export function useBlockFilter(): <T extends { pubkey: string }>(items: T[]) => T[] {
  const blocked = useBlockStore((s) => s.blockedPubkeys)
  return useMemo(
    () => <T extends { pubkey: string }>(items: T[]) => (blocked.size ? items.filter((m) => !blocked.has(m.pubkey)) : items),
    [blocked],
  )
}
