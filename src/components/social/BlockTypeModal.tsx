import { Globe, Lock } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import type { BlockType } from '@/stores/blockStore'

interface BlockTypeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (type: BlockType) => void
  displayName?: string
}

/** Asks whether to block a user publicly or privately (mirrors DEN Chat). */
export function BlockTypeModal({ open, onOpenChange, onSelect, displayName }: BlockTypeModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1c1c1c] border-[#262626]">
        <DialogHeader>
          <DialogTitle className="text-neutral-100">
            Block {displayName ? `"${displayName}"` : 'user'}
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            Choose how you want to block this user.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 py-1">
          <button
            onClick={() => onSelect('private')}
            className="w-full flex items-start gap-3 px-4 py-3 rounded-lg border border-[#262626] bg-[#212121] hover:border-[#404040] transition-colors text-left"
          >
            <Lock size={16} className="mt-0.5 shrink-0 text-neutral-400" />
            <div>
              <p className="text-sm font-medium text-neutral-100">Block privately</p>
              <p className="mt-0.5 text-xs text-neutral-500 leading-relaxed">
                Only you will see this block. Others won't know you've blocked this person. It's encrypted to you.
              </p>
            </div>
          </button>

          <button
            onClick={() => onSelect('public')}
            className="w-full flex items-start gap-3 px-4 py-3 rounded-lg border border-[#262626] bg-[#212121] hover:border-[#404040] transition-colors text-left"
          >
            <Globe size={16} className="mt-0.5 shrink-0 text-neutral-400" />
            <div>
              <p className="text-sm font-medium text-neutral-100">Block publicly</p>
              <p className="mt-0.5 text-xs text-neutral-500 leading-relaxed">
                Your followers and Web of Trust connections will see this block, helping them filter unwanted users.
              </p>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
