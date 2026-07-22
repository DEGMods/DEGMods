import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Trash2, RefreshCw } from 'lucide-react'
import type { Event as NostrEvent } from 'nostr-tools'
import { Button } from '@/components/ui/button'
import { RequestDeleteDialog } from '@/components/shared/RequestDeleteDialog'
import { useAuthStore } from '@/stores/authStore'
import { CLIENT_NAME } from '@/lib/constants'

interface DeletedPostScreenProps {
  /** Lowercase noun, e.g. "mod", "blog post", "mod jam". */
  noun: string
  /** Capitalised heading noun, e.g. "Mod", "Blog post", "Mod jam". */
  heading: string
  /** The tombstoned event, when we have it — needed to offer a re-broadcast. */
  event: NostrEvent | null
  title?: string
  backTo: string
  backLabel: string
}

/**
 * Shown when a post resolved but carries a deletion marker.
 *
 * Readers get the short version: it's gone. The author gets the rest, because
 * only they can act on it and the plain message is actively misleading to them
 * — "permanently deleted" reads as finished, when a deletion that reached three
 * of fifteen relays is not finished at all. That's exactly the case that used to
 * happen (see requestDelete), so authors have posts in this half-state right
 * now: hidden here, still served elsewhere.
 *
 * The retry re-broadcasts from the tombstone itself, which carries the `d` tag
 * and coordinate the deletion needs. It re-tombstones at created_at + 1 and
 * re-sends the kind 5, both to every reachable relay.
 */
export function DeletedPostScreen({ noun, heading, event, title, backTo, backLabel }: DeletedPostScreenProps) {
  const navigate = useNavigate()
  const myPubkey = useAuthStore((s) => s.pubkey)
  const [retryOpen, setRetryOpen] = useState(false)
  const isAuthor = !!event && !!myPubkey && event.pubkey === myPubkey

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
      <Trash2 className="h-12 w-12 text-red-400" />
      <h2 className="text-xl font-semibold text-neutral-200">{heading} deleted</h2>

      {isAuthor ? (
        <div className="max-w-xl space-y-3 text-center">
          <p className="text-sm text-neutral-400">
            This is your {noun}, and it carries a deletion marker — so {CLIENT_NAME} won&rsquo;t show it.
            The event itself still exists on relays that received the marker, and any relay that
            never received it is still serving the original.
          </p>
          <p className="text-sm text-neutral-400">
            Deletion is best-effort and can only reach relays this client knows about. Re-broadcasting
            is safe to repeat: it re-sends the deletion to every relay reachable now, which may be more
            than were reachable the first time.
          </p>
        </div>
      ) : (
        <p className="text-sm text-neutral-400">This {noun} has been permanently deleted.</p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" onClick={() => navigate(backTo)}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          {backLabel}
        </Button>
        {isAuthor && (
          <Button onClick={() => setRetryOpen(true)} className="bg-purple-600 hover:bg-purple-700">
            <RefreshCw className="mr-2 h-4 w-4" />
            Re-broadcast deletion
          </Button>
        )}
      </div>

      {isAuthor && event && (
        <RequestDeleteDialog
          open={retryOpen}
          onOpenChange={setRetryOpen}
          event={event}
          title={title || `this ${noun}`}
          noun={noun}
          onDeleted={() => setRetryOpen(false)}
        />
      )}
    </div>
  )
}
