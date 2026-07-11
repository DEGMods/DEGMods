import { toast } from 'sonner'

/**
 * A single, shared "Checking for updates…" toast for background revalidation
 * (stale-while-revalidate on the home/list pages). Ref-counted so several
 * surfaces refreshing at once show one toast, dismissed when the last finishes.
 *
 * Pair every beginRefresh() with an endRefresh() (use try/finally).
 */
const TOAST_ID = 'bg-refresh'
let active = 0

export function beginRefresh(): void {
  active += 1
  if (active === 1) {
    toast.loading('Checking for updates…', { id: TOAST_ID })
  }
}

export function endRefresh(): void {
  active = Math.max(0, active - 1)
  if (active === 0) {
    toast.dismiss(TOAST_ID)
  }
}
