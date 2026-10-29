import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Loader2, AlertTriangle, ExternalLink, Copy, Check } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { useNsfwReveal } from '@/hooks/useNsfwReveal'
import { BlossomImage } from '@/components/shared/BlossomImage'
import { OpenHubModal } from '@/components/social/HubEventCard'
import { HUB_KIND, parseHubEvent, hubNaddr, type Hub, type HubRec } from '@/lib/nostr/hubs'
import { cn } from '@/lib/utils'

// A far-future created_at shouldn't win "newest" — ignore anything dated beyond a
// day ahead (clock skew allowance).
const futureCutoff = () => Math.floor(Date.now() / 1000) + 86400

/**
 * A DEN Chat hub card: resolves the hub event for a recommendation coordinate and
 * renders its banner / icon / name / description / topics with Copy + Open actions.
 * Media goes through BlossomImage (server failover + hash verification). Returns
 * null when the hub can't be resolved, so a broken recommendation is hidden rather
 * than shown broken. Shared by the home "Community hubs" section and the per-author
 * hub sections on mod/blog/profile pages.
 */
export function HubCard({ rec }: { rec: HubRec }) {
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
        const newest = events.filter((e) => e.created_at <= cutoff).sort((a, b) => b.created_at - a.created_at)[0]
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
      <div className="flex h-full items-center gap-2 rounded-xl border border-[#262626] bg-[#1c1c1c] px-3 py-6 text-xs text-neutral-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading hub…
      </div>
    )
  }
  if (!hub) return null // unresolved recommendation — hide rather than show broken

  const hideMedia = hub.nsfw && !revealed

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c]">
      <div className="relative aspect-[3/1] w-full bg-[#212121]">
        {hub.banner ? (
          <BlossomImage src={hub.banner} alt="" className={cn('h-full w-full object-cover', hideMedia && 'blur-lg')} />
        ) : (
          <img src="/hub-banner-placeholder.jpg" alt="" className="h-full w-full object-cover" />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2.5">
          {hub.icon ? (
            <BlossomImage src={hub.icon} alt="" className={cn('h-9 w-9 shrink-0 rounded-lg object-cover', hideMedia && 'blur-md')} />
          ) : (
            <img src="/hub-icon-placeholder.png" alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover grayscale" />
          )}
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-100">{hub.name}</p>
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
          {hub.topics.slice(0, 3).map((t) => (
            <span key={t} className="rounded-md bg-[#262626] px-1.5 py-0.5 text-[10px] text-neutral-400">{t}</span>
          ))}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-1">
          {hideMedia && (
            <button
              onClick={() => reveal()}
              className="rounded-lg border border-[#262626] px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:border-[#404040]"
            >
              Show content
            </button>
          )}
          {naddr && (
            <>
              <button
                onClick={copy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#262626] px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:border-[#404040]"
                aria-label="Copy hub address"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />} Copy
              </button>
              <button
                onClick={() => setOpenOpen(true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-700"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open hub
              </button>
            </>
          )}
        </div>
      </div>

      {naddr && <OpenHubModal open={openOpen} onOpenChange={setOpenOpen} naddr={naddr} />}
    </div>
  )
}
