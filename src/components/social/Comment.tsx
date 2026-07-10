import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { MessageSquare, User, ShieldCheck } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import type { CommentNode, NostrTarget } from '@/lib/nostr/social'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { CommentContent } from './CommentContent'
import { ReactionButton } from './ReactionButton'
import { ZapButton } from './ZapButton'
import { CommentForm } from './CommentForm'
import { SocialPostMenu } from './SocialPostMenu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

interface CommentProps {
  node: CommentNode
  root: NostrTarget
  onReplyPublished: () => void
  /** Open the thread modal focused on the given comment id. */
  onOpenThread: (id: string) => void
  /** True when this comment is the one currently focused inside the thread modal. */
  focused?: boolean
}

export function Comment({ node, root, onReplyPublished, onOpenThread, focused = false }: CommentProps) {
  const { event, pow, replies } = node
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [replyOpen, setReplyOpen] = useState(false)
  const [deleted, setDeleted] = useState(false)

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(event.pubkey, relays).then(p => {
      if (!cancelled) setProfile(p)
    })
    return () => { cancelled = true }
  }, [event.pubkey])

  const npub = nip19.npubEncode(event.pubkey)
  const name = profile?.display_name || `${npub.slice(0, 10)}…`
  const via = event.tags.find(t => t[0] === 'client')?.[1] || null
  const target: NostrTarget = { id: event.id, pubkey: event.pubkey, kind: 1111 }

  if (deleted) return null

  return (
    <div className={focused
      ? 'rounded-lg border border-[#262626] bg-[#171717] p-4'
      : 'rounded-lg border border-[#262626] bg-[#1c1c1c] p-3'}>
      <div className="flex items-center gap-3">
        <Link to={`/profile/${npub}`} className="shrink-0">
          <Avatar className="h-9 w-9">
            {profile?.picture ? <AvatarImage src={profile.picture} alt={name} /> : null}
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
              <button onClick={() => onOpenThread(event.id)} className="text-xs text-neutral-500 hover:text-purple-400 hover:underline">{formatRelativeTime(event.created_at)}</button>
            )}
            {via && <span className="text-xs text-neutral-600">via {via}</span>}
            {pow > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-neutral-600">
                    <ShieldCheck className="h-3 w-3" />{pow}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Proof of Work: {pow} bits</TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="text-[11px] text-neutral-600 font-mono truncate">{npub.slice(0, 14)}…{npub.slice(-6)}</p>
        </div>
        <SocialPostMenu event={event} onDeleted={() => setDeleted(true)} />
      </div>

      <div className="mt-3"><CommentContent content={event.content} /></div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={focused ? undefined : () => onOpenThread(event.id)}
          disabled={focused}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-2 py-1 text-xs text-neutral-400 transition-colors enabled:hover:border-[#404040] enabled:hover:text-neutral-200 disabled:opacity-100"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {replies.length}
        </button>
        <ReactionButton target={target} className="px-2 py-1 text-xs" />
        <ZapButton target={target} className="px-2 py-1 text-xs" />
        {!focused && (
          <button
            onClick={() => setReplyOpen(o => !o)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:border-[#404040] hover:text-neutral-200"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Reply
          </button>
        )}
      </div>

      {/* Inline reply form for non-focused comments; the focused comment replies via the standalone box below it. */}
      {!focused && replyOpen && (
        <div className="mt-3">
          <CommentForm
            root={root}
            replyTo={target}
            autoFocus
            placeholder={`Reply to ${name}…`}
            onCancel={() => setReplyOpen(false)}
            onPublished={() => { setReplyOpen(false); onReplyPublished() }}
          />
        </div>
      )}
    </div>
  )
}
