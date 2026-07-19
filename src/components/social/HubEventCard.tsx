import { useState, useEffect } from 'react'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { Hash, Loader2, AlertTriangle, ShieldCheck, ExternalLink } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { SafeImage } from '@/components/shared/SafeImage'
import { cn } from '@/lib/utils'

/** DEN Chat hub (NIP-CHAT). Addressable, so one coordinate survives every edit. */
export const HUB_KIND = 36942

interface Hub {
  name: string
  description?: string
  icon?: string
  banner?: string
  topics: string[]
  nsfw: boolean
  minPow: number
}

/**
 * Read a hub event.
 *
 * Identity and moderation live in tags (`n` name, `t` topics, `content-warning`,
 * `w` minimum PoW) while presentation lives in the JSON content under
 * `settings`. Anything missing is simply absent — a hub that only has a name is
 * still a valid hub.
 */
export function parseHubEvent(ev: NostrEvent): Hub {
  let settings: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(ev.content) as { settings?: Record<string, unknown> }
    settings = parsed?.settings ?? {}
  } catch { /* content is optional and may be anything */ }

  const tag = (k: string) => ev.tags.find((t) => t[0] === k)?.[1]
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)

  return {
    name: tag('n') || tag('d') || 'Unnamed hub',
    description: str(settings.description),
    icon: str(settings.icon),
    banner: str(settings.banner),
    topics: ev.tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]).slice(0, 6),
    nsfw: ev.tags.some((t) => t[0] === 'content-warning'),
    minPow: Number(tag('w')) || 0,
  }
}

/**
 * Inline preview of a DEN Chat hub linked from a post or a DM.
 *
 * Read-only by design: joining a hub involves DEN Chat's key exchange, which
 * this client has no part in. So this shows what the hub is and hands off,
 * rather than pretending to offer a join it can't complete.
 */
export function HubEventCard({
  identifier, pubkey, relays,
}: {
  identifier: string
  pubkey: string
  relays?: string[]
}) {
  const [hub, setHub] = useState<Hub | null>(null)
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const read = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    // The naddr's own relay hints come first — a hub is often on relays this
    // client doesn't otherwise read.
    const urls = [...new Set([...(relays ?? []), ...read])]
    fetchEvent(urls, { kinds: [HUB_KIND], authors: [pubkey], '#d': [identifier] })
      .then((ev) => { if (!cancelled) setHub(ev ? parseHubEvent(ev) : null) })
      .catch(() => { if (!cancelled) setHub(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [identifier, pubkey, relays])

  const naddr = (() => {
    try { return nip19.naddrEncode({ kind: HUB_KIND, pubkey, identifier, relays }) } catch { return null }
  })()

  if (loading) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-[#262626] bg-[#1c1c1c] px-3 py-2.5 text-xs text-neutral-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading hub…
      </div>
    )
  }

  if (!hub) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-[#262626] bg-[#1c1c1c] px-3 py-2.5 text-xs text-neutral-500">
        <Hash className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">DEN Chat hub — not found on your relays</span>
      </div>
    )
  }

  const hideMedia = hub.nsfw && !revealed

  return (
    <div className="my-2 max-w-md overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c]">
      {hub.banner && (
        <div className="relative aspect-[3/1] w-full bg-[#212121]">
          <SafeImage src={hub.banner} alt="" className={cn('h-full w-full object-cover', hideMedia && 'blur-lg')} />
        </div>
      )}

      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2.5">
          {hub.icon ? (
            <SafeImage src={hub.icon} alt="" className={cn('h-9 w-9 shrink-0 rounded-lg object-cover', hideMedia && 'blur-md')} />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
              <Hash className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-neutral-100">{hub.name}</p>
            <p className="text-[11px] text-neutral-500">DEN Chat hub</p>
          </div>
        </div>

        {hub.description && !hideMedia && (
          <p className="line-clamp-3 text-xs leading-relaxed text-neutral-400">{hub.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {hub.nsfw && (
            <span className="inline-flex items-center gap-1 rounded-md bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-500">
              <AlertTriangle className="h-3 w-3" /> NSFW
            </span>
          )}
          {hub.minPow > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[#262626] px-1.5 py-0.5 text-[10px] text-neutral-400">
              <ShieldCheck className="h-3 w-3" /> PoW {hub.minPow}
            </span>
          )}
          {hub.topics.map((t) => (
            <span key={t} className="rounded-md bg-[#262626] px-1.5 py-0.5 text-[10px] text-neutral-400">{t}</span>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-0.5">
          {hideMedia && (
            <button
              onClick={() => setRevealed(true)}
              className="rounded-lg border border-[#262626] px-2.5 py-1 text-[11px] text-neutral-300 transition-colors hover:border-[#404040]"
            >
              Show content
            </button>
          )}
          {naddr && (
            <a
              href={`nostr:${naddr}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 px-2.5 py-1 text-[11px] text-purple-300 transition-colors hover:bg-purple-500/10"
            >
              <ExternalLink className="h-3 w-3" /> Open in DEN Chat
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
