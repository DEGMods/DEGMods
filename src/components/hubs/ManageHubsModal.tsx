import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { HubRecommendationsEditor } from '@/components/hubs/HubRecommendationsEditor'

/**
 * Lets a logged-in creator manage the DEN Chat hubs they recommend — the list
 * shown on their profile and posts. Same add / remove / drag-reorder / publish as
 * the admin's site list, in a modal. Opened from the pen button on their own
 * profile's Community hub section.
 */
export function ManageHubsModal({
  open,
  onOpenChange,
  onPublished,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPublished?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#262626] bg-[#1c1c1c] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-neutral-100">Manage your community hubs</DialogTitle>
          <DialogDescription className="text-neutral-400">
            Recommend DEN Chat hubs on your profile and posts. The first one is the one that shows; drag to
            reorder, and paste a hub&apos;s naddr to add it.
          </DialogDescription>
        </DialogHeader>
        <HubRecommendationsEditor shownCount={1} onPublished={onPublished} />
      </DialogContent>
    </Dialog>
  )
}
