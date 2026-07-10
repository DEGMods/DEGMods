import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { Loader2, User } from 'lucide-react'
import { cn, formatRelativeTime } from '@/lib/utils'
import { KINDS } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { zapReceiptAmountMsat } from '@/lib/nostr/social'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { NoteContent } from './NoteContent'
import { ThreadModal } from './ThreadModal'

const tabTrigger = 'py-1.5 data-[state=active]:bg-[#262626] data-[state=active]:text-purple-400'

function parseZap(receipt: NostrEvent): { sender?: string; sats: number } {
  let sats = 0
  try { sats = Math.round(zapReceiptAmountMsat(receipt) / 1000) } catch { /* ignore */ }
  let sender: string | undefined
  const desc = receipt.tags.find((t) => t[0] === 'description')?.[1]
  if (desc) { try { const req = JSON.parse(desc); if (typeof req.pubkey === 'string') sender = req.pubkey } catch { /* ignore */ } }
  return { sender, sats }
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active ? 'border-purple-500/50 bg-purple-500/15 text-purple-300' : 'border-[#262626] text-neutral-500 hover:border-[#404040]',
      )}
    >
      {label}
    </button>
  )
}

function FilterChips<T extends string>({ types, enabled, onToggle }: { types: { id: T; label: string }[]; enabled: Set<T>; onToggle: (id: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map((t) => <ToggleChip key={t.id} label={t.label} active={enabled.has(t.id)} onClick={() => onToggle(t.id)} />)}
    </div>
  )
}

function Actor({ pubkey, suffix }: { pubkey: string; suffix: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(pubkey, relays).then((p) => { if (!cancelled) setProfile(p) })
    return () => { cancelled = true }
  }, [pubkey])
  const npub = nip19.npubEncode(pubkey)
  const name = profile?.display_name || `${npub.slice(0, 10)}…`
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1 text-sm">
      <Link to={`/profile/${npub}`} onClick={(e) => e.stopPropagation()} className="shrink-0">
        <Avatar className="h-7 w-7">
          {profile?.picture ? <AvatarImage src={profile.picture as string} alt={name} /> : null}
          <AvatarFallback className="bg-[#212121] text-neutral-400"><User className="h-3.5 w-3.5" /></AvatarFallback>
        </Avatar>
      </Link>
      <div className="min-w-0">
        <Link to={`/profile/${npub}`} onClick={(e) => e.stopPropagation()} className="font-medium text-neutral-200 hover:text-purple-400">{name}</Link>
        <span className="text-neutral-500"> {suffix}</span>
      </div>
    </div>
  )
}

function useToggleSet<T extends string>(all: T[]) {
  const [enabled, setEnabled] = useState<Set<T>>(() => new Set(all))
  const toggle = (id: T) => setEnabled((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  return { enabled, toggle }
}

// ─── Social (kind 1) notifications ──────────────────────────────────────

type SocialType = 'mention' | 'reply' | 'reaction' | 'repost' | 'quote-repost' | 'zap'
interface SocialNotif { id: string; type: SocialType; event: NostrEvent; createdAt: number; actor: string; sats?: number; sourceId?: string; rootNote?: NostrEvent }

const SOCIAL_TYPES: { id: SocialType; label: string }[] = [
  { id: 'mention', label: 'Mentions' },
  { id: 'reply', label: 'Replies' },
  { id: 'reaction', label: 'Reactions' },
  { id: 'repost', label: 'Reposts' },
  { id: 'quote-repost', label: 'Quotes' },
  { id: 'zap', label: 'Zaps' },
]

function SocialNotifRow({ notif }: { notif: SocialNotif }) {
  const [threadOpen, setThreadOpen] = useState(false)
  const verb =
    notif.type === 'mention' ? 'mentioned you'
      : notif.type === 'reply' ? 'replied to you'
        : notif.type === 'reaction' ? `reacted ${notif.event.content || '❤️'}`
          : notif.type === 'repost' ? 'reposted your post'
            : notif.type === 'quote-repost' ? 'quoted your post'
              : `zapped ${notif.sats?.toLocaleString() ?? 0} sats`
  const showContent = notif.type === 'mention' || notif.type === 'reply' || notif.type === 'quote-repost'
  const clickable = !!notif.rootNote

  return (
    <div className="rounded-lg border border-[#262626] bg-[#1c1c1c]">
      <div
        onClick={() => clickable && setThreadOpen(true)}
        className={cn('rounded-lg p-3', clickable && 'cursor-pointer hover:bg-[#212121]')}
      >
        <div className="flex items-center gap-2">
          <Actor pubkey={notif.actor} suffix={verb} />
          <span className="shrink-0 text-xs text-neutral-600">{formatRelativeTime(notif.createdAt)}</span>
        </div>
        {showContent && <div className="mt-2 pl-9"><NoteContent event={notif.event} noEmbed /></div>}
      </div>
      {clickable && <ThreadModal open={threadOpen} onOpenChange={setThreadOpen} rootNote={notif.rootNote!} />}
    </div>
  )
}

function SocialNotifications({ myPubkey }: { myPubkey: string }) {
  const [notifs, setNotifs] = useState<SocialNotif[]>([])
  const [loading, setLoading] = useState(true)
  const { enabled, toggle } = useToggleSet<SocialType>(SOCIAL_TYPES.map((t) => t.id))

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const kindOk = (ev: NostrEvent) => { const k = ev.tags.find((t) => t[0] === 'k'); return !k || k[1] === '1' }
      const sourceOf = (ev: NostrEvent) => ev.tags.find((t) => t[0] === 'e')?.[1]
      try {
        const [mentions, reactions, reposts, zaps] = await Promise.all([
          fetchEvents(relays, { kinds: [1], '#p': [myPubkey], limit: 50 }, 6000),
          fetchEvents(relays, { kinds: [7], '#p': [myPubkey], limit: 50 }, 6000),
          fetchEvents(relays, { kinds: [6], '#p': [myPubkey], limit: 30 }, 6000),
          fetchEvents(relays, { kinds: [9735], '#p': [myPubkey], limit: 30 }, 6000),
        ])
        const out: SocialNotif[] = []
        for (const ev of mentions) {
          if (ev.pubkey === myPubkey) continue
          const type: SocialType = ev.tags.some((t) => t[0] === 'q') ? 'quote-repost' : ev.tags.some((t) => t[0] === 'e') ? 'reply' : 'mention'
          out.push({ id: ev.id, type, event: ev, createdAt: ev.created_at, actor: ev.pubkey })
        }
        for (const ev of reactions) { if (ev.pubkey === myPubkey || !kindOk(ev)) continue; out.push({ id: ev.id, type: 'reaction', event: ev, createdAt: ev.created_at, actor: ev.pubkey, sourceId: sourceOf(ev) }) }
        for (const ev of reposts) { if (ev.pubkey === myPubkey || !kindOk(ev)) continue; out.push({ id: ev.id, type: 'repost', event: ev, createdAt: ev.created_at, actor: ev.pubkey, sourceId: sourceOf(ev) }) }
        for (const ev of zaps) { if (!kindOk(ev)) continue; const z = parseZap(ev); if (z.sender === myPubkey) continue; out.push({ id: ev.id, type: 'zap', event: ev, createdAt: ev.created_at, actor: z.sender || ev.pubkey, sats: z.sats, sourceId: sourceOf(ev) }) }

        // Resolve the source posts for reactions/reposts/zaps so they're clickable.
        const srcIds = [...new Set(out.filter((n) => n.sourceId).map((n) => n.sourceId!))]
        const srcMap = new Map<string, NostrEvent>()
        if (srcIds.length) {
          const srcEvents = await fetchEvents(relays, { ids: srcIds.slice(0, 100) }, 6000)
          for (const e of srcEvents) srcMap.set(e.id, e)
        }
        for (const n of out) {
          n.rootNote = (n.type === 'mention' || n.type === 'reply' || n.type === 'quote-repost') ? n.event : (n.sourceId ? srcMap.get(n.sourceId) : undefined)
        }

        out.sort((a, b) => b.createdAt - a.createdAt)
        if (!cancelled) setNotifs(out)
      } catch {
        if (!cancelled) setNotifs([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [myPubkey])

  const filtered = useMemo(() => notifs.filter((n) => enabled.has(n.type)), [notifs, enabled])

  return (
    <div className="space-y-4">
      <FilterChips types={SOCIAL_TYPES} enabled={enabled} onToggle={toggle} />
      {loading ? <Loading /> : filtered.length === 0 ? <Empty /> : (
        <div className="space-y-3">{filtered.map((n) => <SocialNotifRow key={`${n.type}-${n.id}`} notif={n} />)}</div>
      )}
    </div>
  )
}

// ─── Mods / Blogs (addressable) notifications ───────────────────────────

type AddrType = 'comment' | 'reaction' | 'zap'
interface AddrNotif { id: string; type: AddrType; event: NostrEvent; createdAt: number; actor: string; sats?: number; aTag: string }

const ADDR_TYPES: { id: AddrType; label: string }[] = [
  { id: 'comment', label: 'Comments' },
  { id: 'reaction', label: 'Reactions' },
  { id: 'zap', label: 'Zaps' },
]

function aTagToHref(aTag: string): string | null {
  const [kindStr, pubkey, ...rest] = aTag.split(':')
  const kind = Number(kindStr)
  if (!kind || !pubkey) return null
  try {
    const naddr = nip19.naddrEncode({ kind, pubkey, identifier: rest.join(':') })
    return kind === KINDS.MOD ? `/mod/${naddr}` : `/blog/${naddr}`
  } catch { return null }
}

function AddrNotifRow({ notif, title }: { notif: AddrNotif; title: string }) {
  const navigate = useNavigate()
  const base = aTagToHref(notif.aTag)
  // For comment notifications, deep-link to the comment so the post scrolls to
  // its comments and opens the thread modal focused on it.
  const href = base && notif.type === 'comment' ? `${base}?c=${notif.event.id}` : base
  const verb =
    notif.type === 'comment' ? 'commented on'
      : notif.type === 'reaction' ? `reacted ${notif.event.content || '❤️'} to`
        : `zapped ${notif.sats?.toLocaleString() ?? 0} sats to`

  return (
    <div
      onClick={() => href && navigate(href)}
      className={cn('rounded-lg border border-[#262626] bg-[#1c1c1c] p-3', href && 'cursor-pointer hover:border-[#404040]')}
    >
      <div className="flex items-center gap-2">
        <Actor pubkey={notif.actor} suffix={<>{verb} <span className="text-neutral-300">"{title}"</span></>} />
        <span className="shrink-0 text-xs text-neutral-600">{formatRelativeTime(notif.createdAt)}</span>
      </div>
      {notif.type === 'comment' && <div className="mt-2 pl-9"><NoteContent event={notif.event} noEmbed /></div>}
    </div>
  )
}

function AddressableNotifications({ myPubkey, kind }: { myPubkey: string; kind: number }) {
  const [notifs, setNotifs] = useState<AddrNotif[]>([])
  const [titles, setTitles] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const { enabled, toggle } = useToggleSet<AddrType>(ADDR_TYPES.map((t) => t.id))

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      try {
        const mine = await fetchEvents(relays, { kinds: [kind], authors: [myPubkey], limit: 200 }, 8000)
        const titleByATag = new Map<string, string>()
        for (const ev of mine) {
          const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
          titleByATag.set(`${kind}:${myPubkey}:${d}`, ev.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled')
        }
        const aTags = [...titleByATag.keys()]
        if (aTags.length === 0) { if (!cancelled) { setNotifs([]); setTitles(titleByATag); setLoading(false) } return }

        const [comments, reactions, zaps] = await Promise.all([
          fetchEvents(relays, { kinds: [1111], '#A': aTags, limit: 100 }, 6000),
          fetchEvents(relays, { kinds: [7], '#a': aTags, limit: 100 }, 6000),
          fetchEvents(relays, { kinds: [9735], '#a': aTags, limit: 50 }, 6000),
        ])
        const out: AddrNotif[] = []
        for (const ev of comments) { if (ev.pubkey === myPubkey) continue; const aTag = ev.tags.find((t) => t[0] === 'A')?.[1]; if (aTag) out.push({ id: ev.id, type: 'comment', event: ev, createdAt: ev.created_at, actor: ev.pubkey, aTag }) }
        for (const ev of reactions) { if (ev.pubkey === myPubkey) continue; const aTag = ev.tags.find((t) => t[0] === 'a')?.[1]; if (aTag) out.push({ id: ev.id, type: 'reaction', event: ev, createdAt: ev.created_at, actor: ev.pubkey, aTag }) }
        for (const ev of zaps) { const aTag = ev.tags.find((t) => t[0] === 'a')?.[1]; if (!aTag) continue; const z = parseZap(ev); if (z.sender === myPubkey) continue; out.push({ id: ev.id, type: 'zap', event: ev, createdAt: ev.created_at, actor: z.sender || ev.pubkey, sats: z.sats, aTag }) }
        out.sort((a, b) => b.createdAt - a.createdAt)
        if (!cancelled) { setNotifs(out); setTitles(titleByATag) }
      } catch {
        if (!cancelled) setNotifs([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [myPubkey, kind])

  const filtered = useMemo(() => notifs.filter((n) => enabled.has(n.type)), [notifs, enabled])

  return (
    <div className="space-y-4">
      <FilterChips types={ADDR_TYPES} enabled={enabled} onToggle={toggle} />
      {loading ? <Loading /> : filtered.length === 0 ? <Empty /> : (
        <div className="space-y-3">{filtered.map((n) => <AddrNotifRow key={`${n.type}-${n.id}`} notif={n} title={titles.get(n.aTag) ?? 'Untitled'} />)}</div>
      )}
    </div>
  )
}

function Loading() {
  return <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading notifications…</div>
}
function Empty() {
  return <p className="py-12 text-center text-sm text-neutral-500">No notifications yet.</p>
}

// ─── Tabbed notifications ───────────────────────────────────────────────

export function NotificationsView({ myPubkey }: { myPubkey: string }) {
  return (
    <Tabs defaultValue="mods" className="w-full">
      <TabsList className="grid h-auto w-full grid-cols-3 items-stretch bg-[#1c1c1c] border border-[#262626]">
        <TabsTrigger value="mods" className={tabTrigger}>Mods</TabsTrigger>
        <TabsTrigger value="blog" className={tabTrigger}>Blog</TabsTrigger>
        <TabsTrigger value="social" className={tabTrigger}>Social</TabsTrigger>
      </TabsList>
      <TabsContent value="mods" className="mt-4"><AddressableNotifications myPubkey={myPubkey} kind={KINDS.MOD} /></TabsContent>
      <TabsContent value="blog" className="mt-4"><AddressableNotifications myPubkey={myPubkey} kind={KINDS.BLOG} /></TabsContent>
      <TabsContent value="social" className="mt-4"><SocialNotifications myPubkey={myPubkey} /></TabsContent>
    </Tabs>
  )
}
