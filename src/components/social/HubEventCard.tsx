import { useState, useEffect } from 'react'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { Hash, Loader2, AlertTriangle, ShieldCheck, ExternalLink } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { SafeImage } from '@/components/shared/SafeImage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** DEN Chat hub (NIP-CHAT). Addressable, so one coordinate survives every edit. */
export const HUB_KIND = 36942

/** The hosted DEN Chat web client. */
const DEFAULT_HUB_CLIENT = 'https://web.denchat.top/#hub/'
/** Remembers a self-hosted client, so it's entered once rather than every time. */
const CUSTOM_CLIENT_KEY = 'deg-mods:hub-client-url'

/** Join a base URL to an address without doubling or dropping the separator. */
function hubUrl(base: string, naddr: string): string {
  const trimmed = base.trim()
  if (!trimmed) return ''
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.endsWith('/') ? `${withProtocol}${naddr}` : `${withProtocol}/${naddr}`
}

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
  const [openOpen, setOpenOpen] = useState(false)

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
            <button
              onClick={() => setOpenOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 px-2.5 py-1 text-[11px] text-purple-300 transition-colors hover:bg-purple-500/10"
            >
              <ExternalLink className="h-3 w-3" /> Open hub
            </button>
          )}
        </div>
      </div>

      {naddr && <OpenHubModal open={openOpen} onOpenChange={setOpenOpen} naddr={naddr} />}
    </div>
  )
}

/**
 * Where to open a hub.
 *
 * DEG Mods can't open one itself, and there's no single client that everyone
 * uses — self-hosting is the norm here. So it offers the hosted client and
 * remembers whatever base URL the reader gives instead.
 */
function OpenHubModal({
  open, onOpenChange, naddr,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  naddr: string
}) {
  const [custom, setCustom] = useState(() => localStorage.getItem(CUSTOM_CLIENT_KEY) ?? '')

  const go = (base: string, remember: boolean) => {
    const url = hubUrl(base, naddr)
    if (!url) return
    if (remember) {
      try { localStorage.setItem(CUSTOM_CLIENT_KEY, base.trim()) } catch { /* private mode */ }
    }
    window.open(url, '_blank', 'noopener,noreferrer')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#262626] bg-[#1c1c1c] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-neutral-100">Open this hub</DialogTitle>
          <DialogDescription className="text-neutral-400">
            Hubs open in a DEN Chat client, not here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <button
            onClick={() => go(DEFAULT_HUB_CLIENT, false)}
            className="flex w-full items-center gap-3 rounded-lg border border-[#262626] bg-[#212121] px-3 py-3 text-left transition-colors hover:border-purple-500/40"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
              <ExternalLink className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-neutral-100">web.denchat.top</span>
              <span className="block truncate text-[11px] text-neutral-500">The hosted client</span>
            </span>
          </button>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">Your own client</label>
            <div className="flex gap-2">
              <Input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { e.preventDefault(); go(custom, true) } }}
                placeholder="https://example.com/#hub/"
                className="border-[#262626] bg-[#212121] font-mono text-xs text-white placeholder:text-neutral-500"
              />
              <Button
                onClick={() => go(custom, true)}
                disabled={!custom.trim()}
                className="shrink-0 bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
              >
                Open
              </Button>
            </div>
            <p className="text-[11px] text-neutral-500">
              The hub address is appended to this. Remembered for next time.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
