import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import type { Event as NostrEvent } from 'nostr-tools'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface RawEventDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  event: NostrEvent
}

/** Shows an event's raw JSON with a copy button. */
export function RawEventDialog({ open, onOpenChange, event }: RawEventDialogProps) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(event, null, 2)

  const copy = () => {
    navigator.clipboard.writeText(json)
    setCopied(true)
    toast.success('Raw event copied')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1c1c1c] border-[#262626] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-neutral-100">Raw event</DialogTitle>
        </DialogHeader>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={copy} className="border-[#262626] text-xs">
            {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
            Copy
          </Button>
        </div>
        <pre className="max-h-[60vh] overflow-auto rounded-lg border border-[#262626] bg-[#0f0f0f] p-3 text-xs text-neutral-300 whitespace-pre-wrap break-all">
          {json}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
