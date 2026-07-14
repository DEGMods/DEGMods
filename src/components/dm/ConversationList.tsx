import { useMemo, useState } from 'react'
import { Search, User, SquarePen } from 'lucide-react'
import { NewChatModal } from './NewChatModal'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { useDMStore, dmDotState, type DMConversation } from '@/stores/dmStore'
import { useUserStore } from '@/stores/userStore'
import { useBlockStore } from '@/stores/blockStore'
import { useProfile } from '@/hooks/useProfile'
import { formatRelativeTime, cn } from '@/lib/utils'

function ConversationRow({ conv, active, dot, onClick }: {
  conv: DMConversation
  active: boolean
  dot: 'purple' | 'gray' | 'none'
  onClick: () => void
}) {
  const { profile, name, npub } = useProfile(conv.pubkey)
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        active ? 'bg-[#262626]' : 'hover:bg-[#212121]',
      )}
    >
      <Avatar className="h-9 w-9">
        {profile?.picture ? <AvatarImage src={profile.picture} alt={name} /> : null}
        <AvatarFallback className="bg-[#212121] text-neutral-400"><User className="h-4 w-4" /></AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-neutral-200">{name}</span>
          <span className="shrink-0 text-[10px] text-neutral-500">{formatRelativeTime(conv.lastTs)}</span>
        </div>
        <span className="block truncate font-mono text-[11px] text-neutral-600">{npub.slice(0, 14)}…{npub.slice(-4)}</span>
      </div>
      {dot === 'purple' && <span className="h-2 w-2 shrink-0 rounded-full bg-purple-500" />}
      {dot === 'gray' && <span className="h-2 w-2 shrink-0 rounded-full bg-neutral-600" />}
    </button>
  )
}

/** Searchable list of DM conversations, newest first. */
export function ConversationList({ onSelect }: { onSelect: (pubkey: string) => void }) {
  const conversations = useDMStore((s) => s.conversations)
  const seenLatest = useDMStore((s) => s.seenLatest)
  const seenOldest = useDMStore((s) => s.seenOldest)
  const active = useDMStore((s) => s.active)
  const blocked = useBlockStore((s) => s.blockedPubkeys)
  const [q, setQ] = useState('')
  const [newOpen, setNewOpen] = useState(false)

  const list = useMemo(() => {
    const all = Object.values(conversations)
      .filter((c) => !blocked.has(c.pubkey)) // never show chats with blocked users
      .sort((a, b) => b.lastTs - a.lastTs)
    const query = q.trim().toLowerCase()
    if (!query) return all
    return all.filter((c) => {
      if (c.pubkey.toLowerCase().includes(query)) return true
      const p = useUserStore.getState().getCachedProfile(c.pubkey)
      const name = (p?.display_name || p?.name || p?.npub || '').toLowerCase()
      return name.includes(query)
    })
  }, [conversations, q, blocked])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#262626] p-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              className="w-full rounded-md border border-[#262626] bg-[#212121] py-2 pl-8 pr-3 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-purple-600/50"
            />
          </div>
          <button
            onClick={() => setNewOpen(true)}
            className="shrink-0 rounded-md border border-[#262626] p-2 text-neutral-400 transition-colors hover:border-[#404040] hover:text-white"
            aria-label="New message"
            title="New message"
          >
            <SquarePen className="h-4 w-4" />
          </button>
        </div>
      </div>
      <NewChatModal open={newOpen} onClose={() => setNewOpen(false)} onOpen={onSelect} />
      <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {list.map((c) => (
          <ConversationRow
            key={c.pubkey}
            conv={c}
            active={active === c.pubkey}
            dot={dmDotState(c.lastTs, seenLatest, seenOldest)}
            onClick={() => onSelect(c.pubkey)}
          />
        ))}
        {list.length === 0 && (
          <p className="p-6 text-center text-sm text-neutral-500">
            {q.trim() ? 'No matches.' : 'No conversations yet.'}
          </p>
        )}
      </div>
    </div>
  )
}
