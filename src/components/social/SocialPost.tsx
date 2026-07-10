import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { MessageSquare, User } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import type { NostrTarget } from '@/lib/nostr/social'
import { fetchReplies, directReplies } from '@/lib/nostr/socialThread'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { ReactionButton } from './ReactionButton'
import { ZapButton } from './ZapButton'
import { SocialReplyForm } from './SocialReplyForm'
import { NoteContent } from './NoteContent'
import { ThreadModal } from './ThreadModal'
import { SocialPostMenu } from './SocialPostMenu'

interface SocialPostProps {
  note: NostrEvent
}

export function SocialPost({ note }: SocialPostProps) {
  const pubkey = note.pubkey
  const npub = nip19.npubEncode(pubkey)
  const profileHref = `/profile/${npub}`
  const via = note.tags.find((t) => t[0] === 'client')?.[1] || null

  const target: NostrTarget = { id: note.id, pubkey, kind: 1 }

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [replyOpen, setReplyOpen] = useState(false)
  const [threadOpen, setThreadOpen] = useState(false)
  const [commentCount, setCommentCount] = useState<number | null>(null)
  const [deleted, setDeleted] = useState(false)

  const name = profile?.display_name || `${npub.slice(0, 10)}…`

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(pubkey, relays).then((p) => { if (!cancelled) setProfile(p) })
    fetchReplies(relays, note.id)
      .then((events) => { if (!cancelled) setCommentCount(directReplies(events, note.id).length) })
      .catch(() => { if (!cancelled) setCommentCount(0) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, pubkey])

  if (deleted) return null

  return (
    <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={profileHref} className="shrink-0">
          <Avatar className="h-9 w-9">
            {profile?.picture ? <AvatarImage src={profile.picture as string} alt={name} /> : null}
            <AvatarFallback className="bg-[#212121] text-neutral-400">
              <User className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link to={profileHref} className="text-sm font-medium text-neutral-200 hover:text-purple-400 transition-colors truncate">
              {name}
            </Link>
            <span className="text-xs text-neutral-600">·</span>
            <button
              onClick={() => setThreadOpen(true)}
              className="text-xs text-neutral-500 hover:text-purple-400 hover:underline"
            >
              {formatRelativeTime(note.created_at)}
            </button>
            {via && <span className="text-xs text-neutral-600">via {via}</span>}
          </div>
          <p className="text-[11px] text-neutral-600 font-mono truncate">{npub.slice(0, 14)}…{npub.slice(-6)}</p>
        </div>
        <SocialPostMenu event={note} onDeleted={() => setDeleted(true)} />
      </div>

      {/* Content */}
      <div className="mt-3">
        <NoteContent event={note} />
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => setThreadOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-[#404040] hover:text-neutral-200"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {commentCount ?? 0}
        </button>
        <ReactionButton target={target} className="px-2 py-1 text-xs" />
        <ZapButton target={target} className="px-2 py-1 text-xs" />

        <button
          onClick={() => setReplyOpen((o) => !o)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:border-[#404040] hover:text-neutral-200"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Reply
        </button>
      </div>

      {replyOpen && (
        <div className="mt-3">
          <SocialReplyForm
            root={{ id: note.id, pubkey }}
            autoFocus
            placeholder={`Reply to ${name}…`}
            onCancel={() => setReplyOpen(false)}
            onPublished={() => {
              setReplyOpen(false)
              setCommentCount((c) => (c ?? 0) + 1)
            }}
          />
        </div>
      )}

      <ThreadModal open={threadOpen} onOpenChange={setThreadOpen} rootNote={note} />
    </div>
  )
}
