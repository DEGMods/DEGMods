import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { formatRelativeTime } from '@/lib/utils'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { NoteContent } from './NoteContent'

/**
 * Two or more of an author's posts share a short code, and the address didn't
 * say which. Rather than guessing — or reporting the link broken when it points
 * at something real — show them and let the reader pick.
 *
 * Choosing appends the distinguishing selector to the address, so the link the
 * reader ends up holding is exact and won't ask again.
 */
/**
 * Preview for an addressable post — its title and summary, which is what
 * distinguishes two mods or blogs. Notes have neither, so they fall back to
 * their content.
 */
export function postPreview(ev: NostrEvent) {
  const tag = (k: string) => ev.tags.find((t) => t[0] === k)?.[1]
  const title = tag('title') || tag('d') || `kind ${ev.kind}`
  const summary = tag('summary') || ev.content.slice(0, 140)
  return (
    <>
      <span className="block truncate text-sm font-medium text-neutral-100">{title}</span>
      {summary && <span className="mt-0.5 line-clamp-2 block text-xs text-neutral-400">{summary}</span>}
    </>
  )
}

export function ShortAddressChooser({
  open, onOpenChange, candidates, onChoose, renderPreview,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  candidates: NostrEvent[]
  onChoose: (event: NostrEvent) => void
  /** Defaults to note content; addressable posts pass `postPreview`. */
  renderPreview?: (event: NostrEvent) => React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto border-[#262626] bg-[#1c1c1c] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-neutral-100">Which post did you mean?</DialogTitle>
          <DialogDescription className="text-neutral-400">
            This short link matches {candidates.length} of this author's posts. Picking one makes
            the link exact.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          {candidates.map((ev) => (
            <button
              key={ev.id}
              type="button"
              onClick={() => onChoose(ev)}
              className="block w-full rounded-lg border border-[#262626] bg-[#212121] p-3 text-left transition-colors hover:border-purple-500/40"
            >
              <span className="mb-1.5 block text-[11px] text-neutral-500">
                {formatRelativeTime(ev.created_at)} · {nip19.noteEncode(ev.id).slice(0, 16)}…
              </span>
              {/* noEmbed: a preview shouldn't pull in quoted posts or galleries. */}
              <span className="pointer-events-none block text-sm text-neutral-200">
                {renderPreview ? renderPreview(ev) : <NoteContent event={ev} noEmbed />}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
