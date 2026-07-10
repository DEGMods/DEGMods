import { useState } from 'react'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { MoreHorizontal, Copy, FileJson, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { RawEventDialog } from '@/components/shared/RawEventDialog'
import { RequestDeleteDialog } from '@/components/shared/RequestDeleteDialog'

/** 3-dot menu for a social note: copy address, view raw, request delete (own posts). */
export function SocialPostMenu({ event, onDeleted }: { event: NostrEvent; onDeleted?: () => void }) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const isOwner = myPubkey === event.pubkey
  const [rawOpen, setRawOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const copyAddress = () => {
    try {
      navigator.clipboard.writeText(nip19.neventEncode({ id: event.id, author: event.pubkey }))
      toast.success('Event address copied')
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="shrink-0 rounded-md p-1 text-neutral-500 transition-colors hover:bg-[#262626] hover:text-white" aria-label="More">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-[#1c1c1c] border-[#262626]">
          <DropdownMenuItem onClick={copyAddress} className="cursor-pointer">
            <Copy className="h-4 w-4 mr-2" /> Copy event address
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRawOpen(true)} className="cursor-pointer">
            <FileJson className="h-4 w-4 mr-2" /> View raw event
          </DropdownMenuItem>
          {isOwner && (
            <>
              <DropdownMenuSeparator className="bg-[#262626]" />
              <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="cursor-pointer text-red-400 focus:text-red-400">
                <Trash2 className="h-4 w-4 mr-2" /> Request delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <RawEventDialog open={rawOpen} onOpenChange={setRawOpen} event={event} />
      <RequestDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        event={event}
        title="this post"
        noun="post"
        requestOnly
        onDeleted={() => { setDeleteOpen(false); onDeleted?.() }}
      />
    </>
  )
}
