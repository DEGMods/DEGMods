import { useSyncExternalStore } from 'react'

/**
 * Ref-counted "background refresh in progress" signal, shown as a single
 * bottom-right pill by <RefreshIndicator>. Several surfaces revalidating at once
 * (home + a list page) share one indicator, hidden when the last finishes.
 *
 * This is a self-rendered indicator rather than a sonner toast: sonner's
 * dismiss/update proved unreliable in this app (a loading toast wouldn't clear),
 * so we own the show/hide directly. Pair every beginRefresh() with endRefresh()
 * (use try/finally).
 */
let active = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function beginRefresh(): void {
  active += 1
  if (active === 1) emit()
}

export function endRefresh(): void {
  active = Math.max(0, active - 1)
  if (active === 0) emit()
}

/** True while any background revalidation is in flight. */
export function useRefreshActive(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => active > 0,
    () => false,
  )
}
