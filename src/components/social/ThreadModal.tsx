import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { ChevronLeft, MessageSquare, User, Loader2 } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { fetchReplies, directReplies, replyParentId, threadRootId, type SocialRef } from '@/lib/nostr/socialThread'
import type { NostrTarget } from '@/lib/nostr/social'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ReactionButton } from './ReactionButton'
import { ZapButton } from './ZapButton'
import { NoteContent } from './NoteContent'
import { SocialReplyForm } from './SocialReplyForm'
import { SocialPostMenu } from './SocialPostMenu'

function clientTag(event: NostrEvent): string | null {
  return event.tags.find((t) => t[0] === 'client')?.[1] || null
}

// ─── A single post / reply in the thread ──────────────────────────────

function ThreadItem({
  event, rootRef, focused, onOpen, onReplyPublished,
}: {
  event: NostrEvent
  rootRef: SocialRef
  focused?: boolean
  onOpen?: () => void
  onReplyPublished: (event?: NostrEvent) => void
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [replyOpen, setReplyOpen] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  const [deleted, setDeleted] = useState(false)

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(event.pubkey, relays).then((p) => { if (!cancelled) setProfile(p) })
    fetchReplies(relays, event.id)
      .then((evs) => { if (!cancelled) setCount(directReplies(evs, event.id).length) })
      .catch(() => { if (!cancelled) setCount(0) })
    return () => { cancelled = true }
  }, [event.id, event.pubkey])

  const npub = nip19.npubEncode(event.pubkey)
  const name = profile?.display_name || `${npub.slice(0, 10)}…`
  const via = clientTag(event)
  const target: NostrTarget = { id: event.id, pubkey: event.pubkey, kind: event.kind }
  const parent: SocialRef | undefined = event.id === rootRef.id ? undefined : { id: event.id, pubkey: event.pubkey }

  if (deleted) return null

  return (
    <div className={focused
      ? 'rounded-lg border border-[#262626] bg-[#171717] p-4'
      : 'rounded-lg border border-[#262626] bg-[#1c1c1c] p-3'}>
      <div className="flex items-center gap-3">
        <Link to={`/profile/${npub}`} className="shrink-0">
          <Avatar className="h-9 w-9">
            {profile?.picture ? <AvatarImage src={profile.picture as string} alt={name} /> : null}
            <AvatarFallback className="bg-[#212121] text-neutral-400"><User className="h-4 w-4" /></AvatarFallback>
          </Avatar>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link to={`/profile/${npub}`} className="text-sm font-medium text-neutral-200 hover:text-purple-400 transition-colors truncate">{name}</Link>
            <span className="text-xs text-neutral-600">·</span>
            {focused ? (
              <span className="text-xs text-neutral-500">{formatRelativeTime(event.created_at)}</span>
            ) : (
              <button onClick={onOpen} className="text-xs text-neutral-500 hover:text-purple-400 hover:underline">{formatRelativeTime(event.created_at)}</button>
            )}
            {via && <span className="text-xs text-neutral-600">via {via}</span>}
          </div>
          <p className="text-[11px] text-neutral-600 font-mono truncate">{npub.slice(0, 14)}…{npub.slice(-6)}</p>
        </div>
        <SocialPostMenu event={event} onDeleted={() => setDeleted(true)} />
      </div>

      <div className="mt-3"><NoteContent event={event} /></div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={focused ? undefined : onOpen}
          disabled={focused}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-2 py-1 text-xs text-neutral-400 transition-colors enabled:hover:border-[#404040] enabled:hover:text-neutral-200 disabled:opacity-100"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {count ?? 0}
        </button>
        <ReactionButton target={target} className="px-2 py-1 text-xs" />
        <ZapButton target={target} className="px-2 py-1 text-xs" />

        {!focused && (
          <button onClick={() => setReplyOpen((o) => !o)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:border-[#404040] hover:text-neutral-200">
            <MessageSquare className="h-3.5 w-3.5" /> Reply
          </button>
        )}
      </div>

      {/* Inline reply form for non-focused replies; the focused post replies via the standalone box below it. */}
      {!focused && replyOpen && (
        <div className="mt-3">
          <SocialReplyForm
            root={rootRef}
            parent={parent}
            autoFocus
            placeholder={`Reply to ${name}…`}
            onCancel={() => setReplyOpen(false)}
            onPublished={(ev) => { setReplyOpen(false); onReplyPublished(ev) }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Standalone reply box shown below the focused post ─────────────────

function ReplyBox({ rootRef, focused, onReplyPublished }: { rootRef: SocialRef; focused: NostrEvent; onReplyPublished: (event?: NostrEvent) => void }) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(focused.pubkey, relays).then((p) => { if (!cancelled) setProfile(p) })
    return () => { cancelled = true }
  }, [focused.pubkey])
  const npub = nip19.npubEncode(focused.pubkey)
  const name = profile?.display_name || `${npub.slice(0, 10)}…`
  const parent: SocialRef | undefined = focused.id === rootRef.id ? undefined : { id: focused.id, pubkey: focused.pubkey }
  return (
    <div className="rounded-lg bg-[#1c1c1c]">
      <SocialReplyForm root={rootRef} parent={parent} placeholder={`Reply to ${name}…`} onPublished={onReplyPublished} />
    </div>
  )
}

// ─── The thread modal (navigable, with a back button) ─────────────────

interface ThreadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rootNote: NostrEvent
}

export function ThreadModal({ open, onOpenChange, rootNote }: ThreadModalProps) {
  const [stack, setStack] = useState<NostrEvent[]>([rootNote])
  const [replies, setReplies] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [parentEvent, setParentEvent] = useState<NostrEvent | null>(null)
  const [rootEvent, setRootEvent] = useState<NostrEvent | null>(null)
  const [loadingParent, setLoadingParent] = useState(false)

  useEffect(() => { if (open) setStack([rootNote]) }, [open, rootNote.id])

  const focused = stack[stack.length - 1]

  // Just the post being replied to — enough context to make sense of the reply
  // without turning the modal into the whole thread. The root is resolved too
  // but not shown: it's needed so a reply composed here threads under the real
  // root rather than under whatever happened to be on screen.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setParentEvent(null); setRootEvent(null)
    const parentId = replyParentId(focused)
    if (!parentId) return
    const rootId = threadRootId(focused)
    setLoadingParent(true)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    ;(async () => {
      try {
        const [parent, root] = await Promise.all([
          fetchEvent(relays, { ids: [parentId] }),
          rootId && rootId !== parentId ? fetchEvent(relays, { ids: [rootId] }) : Promise.resolve(null),
        ])
        if (cancelled) return
        setParentEvent(parent ?? null)
        setRootEvent(root ?? null)
      } catch {
        /* a parent we can't fetch simply isn't shown */
      } finally {
        if (!cancelled) setLoadingParent(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, focused])

  // Best available thread root: the explicit one, else the parent, else this
  // note (which is then a root itself, or its chain couldn't be resolved).
  const rootSource = rootEvent ?? parentEvent ?? focused
  const rootRef: SocialRef = { id: rootSource.id, pubkey: rootSource.pubkey }

  const loadReplies = useCallback(async (eventId: string) => {
    setLoading(true)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    try {
      const evs = await fetchReplies(relays, eventId)
      setReplies(directReplies(evs, eventId))
    } catch {
      setReplies([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) loadReplies(focused.id) }, [open, focused.id, loadReplies])

  /**
   * Show a just-published reply immediately.
   *
   * Refetching instead would usually come back without it: relays need a moment
   * to index, and the request often races the write. Inserting the signed event
   * we already hold means the reply appears the instant it's posted; the next
   * refetch reconciles (deduped by id).
   */
  const addReply = useCallback((event?: NostrEvent) => {
    if (event && replyParentId(event) === focused.id) {
      setReplies((prev) => (prev.some((r) => r.id === event.id) ? prev : [...prev, event]))
    }
    void loadReplies(focused.id)
  }, [focused.id, loadReplies])

  const push = (e: NostrEvent) => setStack((s) => [...s, e])
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))

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
            {stack.length > 1 ? 'Reply' : 'Post'}
          </DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4 py-1">
          {/* The post being replied to — context, not the subject of the modal. */}
          {loadingParent && !parentEvent && (
            <div className="flex items-center gap-2 px-1 text-xs text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading what this replies to…
            </div>
          )}
          {parentEvent && (
            <div className="space-y-2">
              <ThreadItem
                event={parentEvent}
                rootRef={rootRef}
                onOpen={() => push(parentEvent)}
                onReplyPublished={addReply}
              />
              <div className="ml-5 h-3 w-px bg-[#333]" aria-hidden />
            </div>
          )}

          <ThreadItem event={focused} rootRef={rootRef} focused onReplyPublished={addReply} />

          <ReplyBox rootRef={rootRef} focused={focused} onReplyPublished={addReply} />

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading replies…
            </div>
          ) : replies.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">No replies yet.</p>
          ) : (
            <div className="space-y-2">
              {replies.map((reply) => (
                <ThreadItem
                  key={reply.id}
                  event={reply}
                  rootRef={rootRef}
                  onOpen={() => push(reply)}
                  onReplyPublished={addReply}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
