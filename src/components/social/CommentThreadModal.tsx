import { useState, useEffect, useMemo } from 'react'
import { nip19 } from 'nostr-tools'
import { ChevronLeft } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { findCommentPath, type CommentNode, type NostrTarget } from '@/lib/nostr/social'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Comment } from './Comment'
import { CommentForm } from './CommentForm'

// Standalone reply box shown below the focused comment.
function CommentReplyBox({ root, focused, onReplyPublished }: { root: NostrTarget; focused: CommentNode; onReplyPublished: () => void }) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(focused.event.pubkey, relays).then((p) => { if (!cancelled) setProfile(p) })
    return () => { cancelled = true }
  }, [focused.event.pubkey])
  const npub = nip19.npubEncode(focused.event.pubkey)
  const name = profile?.display_name || `${npub.slice(0, 10)}…`
  return (
    <div className="rounded-lg bg-[#1c1c1c]">
      <CommentForm
        root={root}
        replyTo={{ id: focused.event.id, pubkey: focused.event.pubkey, kind: 1111 }}
        placeholder={`Reply to ${name}…`}
        onPublished={onReplyPublished}
      />
    </div>
  )
}

function findNode(nodes: CommentNode[], id: string): CommentNode | null {
  for (const n of nodes) {
    if (n.event.id === id) return n
    const found = findNode(n.replies, id)
    if (found) return found
  }
  return null
}

interface CommentThreadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Full (pruned) comment tree from the section. */
  tree: CommentNode[]
  /** The comment id to focus when the modal opens. */
  focusId: string | null
  root: NostrTarget
  onReplyPublished: () => void
}

export function CommentThreadModal({ open, onOpenChange, tree, focusId, root, onReplyPublished }: CommentThreadModalProps) {
  // A navigation stack of comment ids — drilling into a reply pushes its id.
  // Seed it with the focused comment's full ancestry so the back button can
  // walk up the thread (reply → parent → … → top-level comment).
  const [stack, setStack] = useState<string[]>(focusId ? [focusId] : [])

  useEffect(() => {
    if (open && focusId) setStack(findCommentPath(tree, focusId) ?? [focusId])
    // Only re-seed when the modal opens or the target changes, not on every tree refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusId])

  const focusedId = stack[stack.length - 1] ?? null
  const focused = useMemo(() => (focusedId ? findNode(tree, focusedId) : null), [tree, focusedId])

  const push = (id: string) => setStack(s => [...s, id])
  const back = () => setStack(s => (s.length > 1 ? s.slice(0, -1) : s))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1c1c1c] border-[#262626] max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-neutral-100">
            {stack.length > 1 && (
              <button onClick={back} className="rounded-md p-1 text-neutral-400 hover:bg-[#262626] hover:text-white" aria-label="Back">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {stack.length > 1 ? 'Reply' : 'Comment'}
          </DialogTitle>
        </DialogHeader>

        {!focused ? (
          <p className="py-8 text-center text-sm text-neutral-500">This comment is no longer available.</p>
        ) : (
          <div className="min-w-0 space-y-4 py-1">
            <Comment node={focused} root={root} focused onReplyPublished={onReplyPublished} onOpenThread={push} />

            <CommentReplyBox root={root} focused={focused} onReplyPublished={onReplyPublished} />

            {focused.replies.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-500">No replies yet.</p>
            ) : (
              <div className="space-y-4">
                {focused.replies.map(child => (
                  <Comment
                    key={child.event.id}
                    node={child}
                    root={root}
                    onReplyPublished={onReplyPublished}
                    onOpenThread={push}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
