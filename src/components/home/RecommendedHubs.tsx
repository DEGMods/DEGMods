import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Hash, Loader2, AlertTriangle, ExternalLink, Copy, Check } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { useNsfwReveal } from '@/hooks/useNsfwReveal'
import { SafeImage } from '@/components/shared/SafeImage'
import { OpenHubModal } from '@/components/social/HubEventCard'
import { HUB_KIND, parseHubEvent, hubNaddr, type Hub, type HubRec } from '@/lib/nostr/hubs'
import { cn } from '@/lib/utils'

/**
 * "Recommended Hubs" — the admin-curated list of DEN Chat hubs shown at the
 * bottom of the landing page. The first (priority) hub gets a full-width card
 * (DEG Mods' own hub); the next four sit in a row. Each card opens the hub in a
 * DEN Chat client or copies its address. Hubs that can't be resolved are hidden
 * rather than shown as broken, so the section stays clean.
 */
export function RecommendedHubs({ recs }: { recs: HubRec[] }) {
  const top = recs.slice(0, 5)
  if (top.length === 0) return null

  return (
    <div className="mb-10">
      <h2 className="mb-4 text-2xl font-bold text-white">Recommended Hubs</h2>
      <div className="space-y-3">
        <HubCard rec={top[0]} variant="full" />
        {top.length > 1 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {top.slice(1).map((r) => (
              <HubCard key={r.coord} rec={r} variant="grid" />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// A far-future created_at shouldn't win "newest" — ignore anything dated beyond
// a day ahead (clock skew allowance).
const futureCutoff = () => Math.floor(Date.now() / 1000) + 86400

function HubCard({ rec, variant }: { rec: HubRec; variant: 'full' | 'grid' }) {
  const [hub, setHub] = useState<Hub | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [openOpen, setOpenOpen] = useState(false)
  const { revealed, reveal } = useNsfwReveal()

  useEffect(() => {
    let cancelled = false
    const read = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    // The recommendation's relay hint comes first — a hub is often on relays this
    // client doesn't otherwise read.
    const urls = [...new Set([...(rec.relayHint ? [rec.relayHint] : []), ...read])]
    fetchEvents(urls, { kinds: [HUB_KIND], authors: [rec.pubkey], '#d': [rec.dTag], limit: 5 }, 6000)
      .then((events) => {
        if (cancelled) return
        const cutoff = futureCutoff()
        const newest = events
          .filter((e) => e.created_at <= cutoff)
          .sort((a, b) => b.created_at - a.created_at)[0]
        setHub(newest ? parseHubEvent(newest) : null)
      })
      .catch(() => { if (!cancelled) setHub(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [rec.pubkey, rec.dTag, rec.relayHint])

  const naddr = hub ? hubNaddr(rec.pubkey, rec.dTag, hub.relays.length ? hub.relays : rec.relayHint ? [rec.relayHint] : undefined) : null

  const copy = async () => {
    if (!naddr) return
    try {
      await navigator.clipboard.writeText(naddr)
      setCopied(true)
      toast.success('Hub address copied')
      setTimeout(() => setCopied(false), 1500)
    } catch { toast.error('Could not copy') }
  }

  if (loading) {
    return (
      <div className={cn(
        'flex items-center gap-2 rounded-xl border border-[#262626] bg-[#1c1c1c] px-3 py-3 text-xs text-neutral-500',
        variant === 'full' && 'py-6',
      )}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading hub…
      </div>
    )
  }
  if (!hub) return null // unresolved recommendation — hide rather than show broken

  const hideMedia = hub.nsfw && !revealed
  const full = variant === 'full'

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c]">
      {hub.banner && (
        <div className={cn('relative w-full bg-[#212121]', full ? 'aspect-[5/1]' : 'aspect-[3/1]')}>
          <SafeImage src={hub.banner} alt="" className={cn('h-full w-full object-cover', hideMedia && 'blur-lg')} />
        </div>
      )}

      <div className={cn('flex flex-1 flex-col gap-2 p-3', full && 'md:p-4')}>
        <div className="flex items-center gap-2.5">
          {hub.icon ? (
            <SafeImage src={hub.icon} alt="" className={cn('shrink-0 rounded-lg object-cover', full ? 'h-11 w-11' : 'h-9 w-9', hideMedia && 'blur-md')} />
          ) : (
            <span className={cn('flex shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400', full ? 'h-11 w-11' : 'h-9 w-9')}>
              <Hash className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className={cn('truncate font-semibold text-neutral-100', full ? 'text-base' : 'text-sm')}>{hub.name}</p>
            <p className="text-[11px] text-neutral-500">DEN Chat hub</p>
          </div>
        </div>

        {hub.description && !hideMedia && (
          <p className={cn('text-xs leading-relaxed text-neutral-400', full ? 'line-clamp-2' : 'line-clamp-3')}>{hub.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {hub.nsfw && (
            <span className="inline-flex items-center gap-1 rounded-md bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-500">
              <AlertTriangle className="h-3 w-3" /> NSFW
            </span>
          )}
          {hub.topics.slice(0, full ? 6 : 3).map((t) => (
            <span key={t} className="rounded-md bg-[#262626] px-1.5 py-0.5 text-[10px] text-neutral-400">{t}</span>
          ))}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-1">
          {hideMedia && (
            <button
              onClick={() => reveal()}
              className="rounded-lg border border-[#262626] px-2.5 py-1 text-[11px] text-neutral-300 transition-colors hover:border-[#404040]"
            >
              Show content
            </button>
          )}
          {naddr && (
            <>
              <button
                onClick={() => setOpenOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-purple-700"
              >
                <ExternalLink className="h-3 w-3" /> Open hub
              </button>
              <button
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-2.5 py-1.5 text-[11px] text-neutral-300 transition-colors hover:border-[#404040]"
                aria-label="Copy hub address"
              >
                {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />} Copy
              </button>
            </>
          )}
        </div>
      </div>

      {naddr && <OpenHubModal open={openOpen} onOpenChange={setOpenOpen} naddr={naddr} />}
    </div>
  )
}
