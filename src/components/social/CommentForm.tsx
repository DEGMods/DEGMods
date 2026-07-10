import { useState } from 'react'
import { Loader2, Send, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { buildCommentEvent } from '@/lib/nostr/events'
import { signAndPublish } from '@/lib/nostr/publish'
import type { NostrTarget } from '@/lib/nostr/social'
import { KINDS } from '@/lib/constants'
import type { DownloadEntry } from '@/types/mod'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { CharCounter } from '@/components/shared/CharCounter'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

/** Comment length cap: a quarter of the mod/blog content limit (30000). */
const COMMENT_MAX = 7500
/** Downloads snapshotted into a comment, at most. */
const MAX_SNAPSHOT_DOWNLOADS = 10

interface CommentFormProps {
  root: NostrTarget
  /** When replying to a specific comment; omit for a top-level comment. */
  replyTo?: NostrTarget
  /** The mod's downloads — passed only for top-level comments under a mod post. */
  modDownloads?: DownloadEntry[]
  onPublished: () => void
  onCancel?: () => void
  autoFocus?: boolean
  placeholder?: string
}

export function CommentForm({ root, replyTo, modDownloads, onPublished, onCancel, autoFocus, placeholder }: CommentFormProps) {
  const { pubkey } = useAuthStore()
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [includeDownloads, setIncludeDownloads] = useState(true)
  const [optionsOpen, setOptionsOpen] = useState(false)

  const isMod = root.kind === KINDS.MOD
  // Length cap applies to comments on mod and blog posts.
  const maxLength = isMod || root.kind === KINDS.BLOG ? COMMENT_MAX : undefined
  // Only top-level comments under a mod with downloads get the snapshot option.
  const canSnapshot = isMod && !replyTo && !!modDownloads?.length

  if (!pubkey) {
    return (
      <p className="text-sm text-neutral-500">
        <button
          type="button"
          onClick={() => useLoginModalStore.getState().open()}
          className="text-purple-400 hover:text-purple-300"
        >
          Log in
        </button>{' '}
        to join the conversation.
      </p>
    )
  }

  const submit = async () => {
    const text = content.trim()
    if (!text || sending) return
    if (maxLength && text.length > maxLength) {
      toast.error(`Comment is too long (max ${maxLength.toLocaleString()} characters)`)
      return
    }
    setSending(true)
    try {
      // Snapshot the mod's downloads so there's a record even if the author later
      // edits or deletes the mod post. One ['download', title, string] per link.
      const extraTags = canSnapshot && includeDownloads
        ? modDownloads!.slice(0, MAX_SNAPSHOT_DOWNLOADS)
            .filter(d => d.file?.trim())
            .map(d => ['download', d.title?.trim() || '', d.file.trim()])
        : undefined
      const event = buildCommentEvent({ content: text, rootEvent: root, replyTo, extraTags })
      const res = await signAndPublish(event)
      if (!res.success) throw new Error(res.error)
      setContent('')
      toast.success(replyTo ? 'Reply posted' : 'Comment posted')
      onPublished()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={placeholder ?? 'Write a comment…'}
        rows={3}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
        }}
        className="bg-[#212121] border-[#262626] text-white resize-y min-h-[76px]"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {canSnapshot && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setOptionsOpen(true)}
                  className="h-8 w-8 text-neutral-400 hover:text-neutral-200"
                  aria-label="Comment options"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Comment options</TooltipContent>
            </Tooltip>
          )}
          {maxLength && <CharCounter value={content} max={maxLength} />}
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} className="text-neutral-400">
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            onClick={submit}
            disabled={sending || !content.trim()}
            className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {replyTo ? 'Reply' : 'Comment'}
          </Button>
        </div>
      </div>

      {canSnapshot && (
        <Dialog open={optionsOpen} onOpenChange={setOptionsOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Comment options</DialogTitle>
              <DialogDescription>These apply to the comment you&apos;re posting.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-between gap-3 rounded-md border border-[#262626] bg-[#1c1c1c] px-3 py-2.5">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-neutral-200">Include a record of the mod post&apos;s download links</p>
                <p className="text-xs text-neutral-500">
                  Snapshots the current download links into your comment.
                </p>
              </div>
              <Switch checked={includeDownloads} onCheckedChange={setIncludeDownloads} className="shrink-0" />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
