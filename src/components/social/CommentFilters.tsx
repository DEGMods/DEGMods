import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'

/** Comment view filters. Kept as an object so more can be added over time. */
export interface CommentFilterState {
  /** Show only top-level comments written by the post's author. */
  authorOnly: boolean
}

export const DEFAULT_COMMENT_FILTERS: CommentFilterState = {
  authorOnly: false,
}

interface CommentFiltersProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: CommentFilterState
  onChange: (filters: CommentFilterState) => void
}

export function CommentFilters({ open, onOpenChange, filters, onChange }: CommentFiltersProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Comment filters</DialogTitle>
          <DialogDescription>Adjust what you see in this thread.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-[#262626] bg-[#1c1c1c] px-3 py-2.5">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-neutral-200">Author only comments</p>
              <p className="text-xs text-neutral-500">
                Show only comments from the post&apos;s author, not replies to comments.
              </p>
            </div>
            <Switch
              checked={filters.authorOnly}
              onCheckedChange={(v) => onChange({ ...filters, authorOnly: v })}
              className="shrink-0"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
