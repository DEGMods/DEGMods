import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bell, Rss } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { useFollowsStore } from '@/stores/followsStore'
import { useNotificationsStore } from '@/stores/notificationsStore'
import { PublisherCard } from '@/components/mod/PublisherCard'
import { FeedView } from '@/components/social/FeedView'
import { NotificationsView } from '@/components/social/NotificationsView'
import { Button } from '@/components/ui/button'

type View = 'home' | 'notifications'

function NavButton({ icon: Icon, label, active, dot, onClick }: { icon: typeof Rss; label: string; active: boolean; dot?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-[#262626] text-white' : 'text-neutral-400 hover:bg-[#212121] hover:text-neutral-200',
      )}
    >
      <span className="relative flex">
        <Icon className="h-4 w-4" />
        {dot && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-purple-500 ring-2 ring-[#1c1c1c]" />}
      </span>
      {label}
    </button>
  )
}

export function FeedPage() {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const contactEvent = useFollowsStore((s) => s.contactEvent)
  const loadContacts = useFollowsStore((s) => s.loadContacts)
  const [searchParams] = useSearchParams()
  // Deep-link support: /feed?view=notifications opens the notifications view.
  const [view, setView] = useState<View>(searchParams.get('view') === 'notifications' ? 'notifications' : 'home')
  const hasUnread = useNotificationsStore((s) => s.newestTs > s.lastSeen)

  useEffect(() => { if (myPubkey) loadContacts() }, [myPubkey, loadContacts])
  useEffect(() => { if (myPubkey) useNotificationsStore.getState().refresh(myPubkey) }, [myPubkey])

  // Viewing the notifications marks everything seen (clears the dot) and records
  // the NIP-78 seen marker.
  useEffect(() => {
    if (view === 'notifications' && myPubkey) useNotificationsStore.getState().markSeen(myPubkey)
  }, [view, myPubkey])

  const authors = useMemo(() => {
    const set = new Set<string>()
    if (contactEvent) for (const t of contactEvent.tags) if (t[0] === 'p' && t[1]) set.add(t[1])
    if (myPubkey) set.add(myPubkey)
    return Array.from(set).slice(0, 500)
  }, [contactEvent, myPubkey])

  if (!myPubkey) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Rss className="h-12 w-12 text-neutral-500" />
        <h2 className="text-xl font-semibold text-neutral-200">Your feed</h2>
        <p className="text-neutral-400 text-sm">Log in to see posts from people you follow.</p>
        <Button variant="outline" onClick={() => useLoginModalStore.getState().open()}>Log In</Button>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column: feed / notifications */}
        <div className="lg:col-span-2 min-w-0 order-2 lg:order-1">
          {view === 'home' ? <FeedView authors={authors} /> : <NotificationsView myPubkey={myPubkey} />}
        </div>

        {/* Right column: user card + nav */}
        <div className="space-y-4 lg:sticky lg:top-20 self-start order-1 lg:order-2">
          <PublisherCard pubkey={myPubkey} />
          <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-2 space-y-1">
            <NavButton icon={Rss} label="Feed" active={view === 'home'} onClick={() => setView('home')} />
            <NavButton icon={Bell} label="Notifications" active={view === 'notifications'} dot={hasUnread} onClick={() => setView('notifications')} />
          </div>
        </div>
      </div>
    </div>
  )
}
