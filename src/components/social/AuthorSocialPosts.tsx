import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { User, ArrowRight } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { KINDS } from '@/lib/constants'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { FollowButton } from './FollowButton'

const MAX_POSTS = 3

/** Strip links, nostr refs and media, and collapse whitespace, for a text preview. */
function toPreview(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/nostr:\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A kind-1 note is an original post (not a reply) when it carries no `e` tag. */
function isOriginal(note: NostrEvent): boolean {
  return !note.tags.some((t) => t[0] === 'e')
}

/**
 * Shows the author's latest original kind-1 posts (not replies), with text-only
 * previews. Renders nothing until at least one qualifying post is found.
 */
export function AuthorSocialPosts({ pubkey }: { pubkey: string }) {
  const [posts, setPosts] = useState<{ note: NostrEvent; preview: string }[]>([])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loaded, setLoaded] = useState(false)

  const npub = nip19.npubEncode(pubkey)
  const profileHref = `/profile/${npub}`
  const socialHref = `/profile/${npub}?tab=social`
  const name = profile?.display_name || `${npub.slice(0, 10)}…`

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(pubkey, relays).then((p) => { if (!cancelled) setProfile(p) })
    fetchEvents(relays, { kinds: [KINDS.SHORT_NOTE], authors: [pubkey], limit: 40 }, 6000)
      .then((events) => {
        if (cancelled) return
        const picked = events
          .filter(isOriginal)
          .sort((a, b) => b.created_at - a.created_at)
          .map((note) => ({ note, preview: toPreview(note.content) }))
          .filter((p) => p.preview.length > 0)
          .slice(0, MAX_POSTS)
        setPosts(picked)
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [pubkey])

  if (!loaded || posts.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-neutral-200">Latest from the author</h2>
      <div className="space-y-3">
        {posts.map(({ note, preview }) => (
          <div key={note.id} className="space-y-3 rounded-lg border border-[#262626] bg-[#1c1c1c] p-4">
            {/* Row 1: profile picture, name, follow */}
            <div className="flex items-center gap-3">
              <Link to={profileHref} className="shrink-0">
                <Avatar className="h-9 w-9">
                  {profile?.picture ? <AvatarImage src={profile.picture as string} alt={name} /> : null}
                  <AvatarFallback className="bg-[#212121] text-neutral-400">
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              </Link>
              <Link
                to={profileHref}
                className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200 transition-colors hover:text-purple-400"
              >
                {name}
              </Link>
              <FollowButton pubkey={pubkey} className="shrink-0" />
            </div>

            {/* Row 2: content preview (text only, 3 lines max) */}
            <p className="line-clamp-3 break-words text-sm leading-relaxed text-neutral-300">
              {preview}
            </p>

            {/* Row 3: view post → author's profile Social tab */}
            <Link
              to={socialHref}
              className="inline-flex items-center gap-1 text-xs font-medium text-purple-400 transition-colors hover:text-purple-300"
            >
              View post <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
