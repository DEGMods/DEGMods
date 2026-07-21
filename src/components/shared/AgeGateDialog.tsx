import { AlertTriangle } from 'lucide-react'
import { useAgeGateStore } from '@/stores/ageGateStore'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

/**
 * The one adult-confirmation prompt, mounted once at the app root.
 *
 * Rendered globally rather than per call site so every route into sensitive
 * media asks the same question in the same words — a reveal button, the
 * preferences toggle and the NSFW filters all open this.
 *
 * Declining is the safe path, so dismissing the dialog any way at all (Escape,
 * backdrop, the No button) counts as "no" and the pending action is dropped.
 */
export function AgeGateDialog() {
  const pending = useAgeGateStore((s) => s.pending)
  const accept = useAgeGateStore((s) => s.accept)
  const decline = useAgeGateStore((s) => s.decline)

  return (
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open) decline() }}>
      <DialogContent className="bg-[#1c1c1c] border-[#262626] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            Adult content
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            This shows media marked as sensitive or adult. Are you a legal adult in
            the jurisdiction you're in — typically 18 or older?
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-neutral-500">
          Your answer is saved on this device only. It isn't published, sent anywhere,
          or attached to your account, and you won't be asked again.
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={decline}
            className="text-neutral-300 hover:bg-[#262626]"
          >
            No
          </Button>
          <Button
            onClick={accept}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            Yes, I'm a legal adult
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
