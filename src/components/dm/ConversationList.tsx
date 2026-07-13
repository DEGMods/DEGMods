import { useMemo, useState } from 'react'
import { Search, User } from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { useDMStore, type DMConversation } from '@/stores/dmStore'
import { useUserStore } from '@/stores/userStore'
import { useProfile } from '@/hooks/useProfile'
import { formatRelativeTime, cn } from '@/lib/utils'

function ConversationRow({ conv, active, unread, onClick }: {
  conv: DMConversation
  active: boolean
  unread: boolean
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
      {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-purple-500" />}
    </button>
  )
}

/** Searchable list of DM conversations, newest first. */
export function ConversationList({ onSelect }: { onSelect: (pubkey: string) => void }) {
  const conversations = useDMStore((s) => s.conversations)
  const read = useDMStore((s) => s.read)
  const active = useDMStore((s) => s.active)
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    const all = Object.values(conversations).sort((a, b) => b.lastTs - a.lastTs)
    const query = q.trim().toLowerCase()
    if (!query) return all
    return all.filter((c) => {
      if (c.pubkey.toLowerCase().includes(query)) return true
      const p = useUserStore.getState().getCachedProfile(c.pubkey)
      const name = (p?.display_name || p?.name || p?.npub || '').toLowerCase()
      return name.includes(query)
    })
  }, [conversations, q])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#262626] p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="w-full rounded-md border border-[#262626] bg-[#212121] py-2 pl-8 pr-3 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-purple-600/50"
          />
        </div>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {list.map((c) => (
          <ConversationRow
            key={c.pubkey}
            conv={c}
            active={active === c.pubkey}
            unread={c.lastIncomingTs > (read[c.pubkey] ?? 0)}
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
