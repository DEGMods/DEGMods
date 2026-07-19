import { useState } from 'react'
import { AlertTriangle, Trash2, Loader2, Check, X, Circle } from 'lucide-react'
import { toast } from 'sonner'
import type { Event as NostrEvent } from 'nostr-tools'
import { requestDelete, signAndPublish, type DeleteStep } from '@/lib/nostr/publish'
import { buildDeletionRequest } from '@/lib/nostr/events'
import { forgetCachedEvent } from '@/lib/nostr/eventCache'
import { purgeFromModCaches } from '@/hooks/useProgressiveMods'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

type Phase = 'pending' | 'mining' | 'signing' | 'publishing' | 'done' | 'error'

const PHASE_TEXT: Record<Phase, string> = {
  pending: 'Waiting…',
  mining: 'Proof of work…',
  signing: 'Signing…',
  publishing: 'Broadcasting to relays…',
  done: 'Done',
  error: 'Failed',
}

function StepRow({ label, phase }: { label: string; phase: Phase }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#262626] bg-[#212121] p-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {phase === 'done' ? (
          <Check className="h-4 w-4 text-green-400" />
        ) : phase === 'error' ? (
          <X className="h-4 w-4 text-red-400" />
        ) : phase === 'pending' ? (
          <Circle className="h-3.5 w-3.5 text-neutral-600" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
        )}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-neutral-200">{label}</p>
        <p className="text-xs text-neutral-500">{PHASE_TEXT[phase]}</p>
      </div>
    </div>
  )
}

interface RequestDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  event: NostrEvent
  /** Title of the thing being deleted (shown in the prompt). */
  title: string
  /** Lowercase noun, e.g. "mod" or "blog post". */
  noun: string
  /** Only broadcast the kind-5 deletion request (skip the tombstone edit). For
   *  non-replaceable events like kind-1 notes where editing doesn't apply. */
  requestOnly?: boolean
  /** Called once the request completes successfully. */
  onDeleted: () => void
}

/**
 * Confirmation + progress dialog for a best-effort delete request. Shows the
 * two-phase process (tombstone the event, then broadcast the kind-5 request),
 * each reporting its proof-of-work / signing / publishing phase.
 */
export function RequestDeleteDialog({ open, onOpenChange, event, title, noun, requestOnly, onDeleted }: RequestDeleteDialogProps) {
  const [running, setRunning] = useState(false)
  const [edit, setEdit] = useState<Phase>('pending')
  const [request, setRequest] = useState<Phase>('pending')

  const run = async () => {
    setRunning(true)
    setEdit('pending')
    setRequest('pending')

    const res = requestOnly
      ? await signAndPublish(buildDeletionRequest(event), (phase) => setRequest(phase as Phase))
      : await requestDelete(event, (step: DeleteStep, phase: Phase) => {
        if (step === 'edit') setEdit(phase)
        else setRequest(phase)
      })

    if (res.success) {
      // Evict every cached copy. The tombstone is published, but the listing and
      // event caches still hold the pre-delete event, and relays that honour the
      // deletion stop returning the coordinate — so nothing would ever overwrite
      // it and the deleted item keeps showing up in lists.
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
      if (dTag !== undefined) {
        forgetCachedEvent(`${event.kind}:${event.pubkey}:${dTag}`)
        purgeFromModCaches(event.pubkey, dTag)
      }
      toast.success(`Deletion requested for this ${noun}`)
      onDeleted()
    } else {
      toast.error(res.error || 'Delete request failed')
      setRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) onOpenChange(o) }}>
      <DialogContent className="bg-[#1c1c1c] border-[#262626]">
        {!running ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-neutral-100">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                Request Deletion
              </DialogTitle>
              <DialogDescription className="text-neutral-400">
                Request deletion of <strong className="text-neutral-200">{title}</strong>?
                This broadcasts a deletion request{requestOnly ? '' : ` and a tombstoned version of the ${noun}`} to
                your relays. Deletion is <strong className="text-neutral-300">best-effort</strong>:
                relays and clients that honor it will drop the {noun}, but copies may persist
                on relays that ignore deletion requests.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[#262626]">
                Cancel
              </Button>
              <Button variant="destructive" onClick={run}>
                <Trash2 className="h-4 w-4 mr-2" />
                Request Delete
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-neutral-100">Requesting deletion…</DialogTitle>
              <DialogDescription className="text-neutral-400">
                Best-effort: broadcasting the deletion request to your relays.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2.5">
              {!requestOnly && <StepRow label="Publish tombstoned (edited) version" phase={edit} />}
              <StepRow label="Broadcast deletion request" phase={request} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
