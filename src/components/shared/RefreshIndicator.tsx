import { Loader2 } from 'lucide-react'
import { useRefreshActive } from '@/lib/ui/refreshToast'

/**
 * Bottom-right "Checking for updates…" pill shown while a background
 * revalidation is in flight (stale-while-revalidate on the home/list pages).
 * Self-rendered (not a sonner toast) so show/hide is fully under our control.
 */
export function RefreshIndicator() {
  const active = useRefreshActive()
  if (!active) return null
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-lg border border-[#2e2932] bg-[#1f1b22] px-3 py-2 text-sm text-neutral-200 shadow-lg shadow-black/30">
      <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
      Checking for updates…
    </div>
  )
}
