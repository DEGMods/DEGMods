import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { User, Loader2 } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { NoteContent } from './NoteContent'

export interface EmbedRef {
  id?: string
  addr?: { kind: number; pubkey: string; identifier: string }
}

/** A quoted Nostr event embedded inside a note (rendered without nested quotes). */
export function EmbeddedNote({ embed }: { embed: EmbedRef }) {
  const [event, setEvent] = useState<NostrEvent | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    const filter = embed.id
      ? { ids: [embed.id] }
      : { kinds: [embed.addr!.kind], authors: [embed.addr!.pubkey], '#d': [embed.addr!.identifier] }
    fetchEvent(relays, filter)
      .then((ev) => {
        if (cancelled) return
        setEvent(ev)
        setLoading(false)
        if (ev) useUserStore.getState().fetchProfile(ev.pubkey, relays).then((p) => { if (!cancelled) setProfile(p) })
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [embed.id, embed.addr?.kind, embed.addr?.pubkey, embed.addr?.identifier])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#262626] bg-[#171717] p-3 text-xs text-neutral-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading quoted post…
      </div>
    )
  }
  if (!event) {
    return <div className="rounded-lg border border-[#262626] bg-[#171717] p-3 text-xs text-neutral-500">Quoted post not found.</div>
  }

  const npub = nip19.npubEncode(event.pubkey)
  const name = profile?.display_name || `${npub.slice(0, 10)}…`

  return (
    <div className="rounded-lg border border-[#262626] bg-[#171717] p-3">
      <div className="flex items-center gap-2">
        <Link to={`/profile/${npub}`} className="shrink-0">
          <Avatar className="h-6 w-6">
            {profile?.picture ? <AvatarImage src={profile.picture as string} alt={name} /> : null}
            <AvatarFallback className="bg-[#212121] text-neutral-400"><User className="h-3 w-3" /></AvatarFallback>
          </Avatar>
        </Link>
        <Link to={`/profile/${npub}`} className="text-xs font-medium text-neutral-300 hover:text-purple-400 transition-colors truncate">{name}</Link>
        <span className="text-[11px] text-neutral-600 shrink-0">· {formatRelativeTime(event.created_at)}</span>
      </div>
      <div className="mt-2">
        <NoteContent event={event} noEmbed />
      </div>
    </div>
  )
}
