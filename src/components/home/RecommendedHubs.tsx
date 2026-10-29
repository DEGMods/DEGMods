import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Hash, Loader2, AlertTriangle, ExternalLink, Copy, Check } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { useNsfwReveal } from '@/hooks/useNsfwReveal'
import { BlossomImage } from '@/components/shared/BlossomImage'
import { OpenHubModal } from '@/components/social/HubEventCard'
import { HUB_KIND, parseHubEvent, hubNaddr, type Hub, type HubRec } from '@/lib/nostr/hubs'
import { cn } from '@/lib/utils'

const DENCHAT_URL = 'https://denchat.top'

/**
 * "DEN Chat community hubs" — the admin-curated DEN Chat hubs near the bottom of
 * the landing page. The first (priority) hub sits on the left of the top row next
 * to a DEN Chat promo that invites mod creators to start their own hub; up to four
 * more hubs render in a grid below. Five hubs total; hubs that can't be resolved
 * are hidden rather than shown broken.
 */
export function RecommendedHubs({ recs }: { recs: HubRec[] }) {
  const top = recs.slice(0, 5)
  if (top.length === 0) return null
  const [first, ...rest] = top

  return (
    <div className="mb-10">
      <h2 className="mb-4 text-2xl font-bold text-white">Community hubs</h2>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <div className="lg:w-1/3">
          <HubCard rec={first} />
        </div>
        <DenChatPromo />
      </div>

      {rest.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rest.map((r) => (
            <HubCard key={r.coord} rec={r} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Promotes starting a DEN Chat hub to mod creators / communities. */
function DenChatPromo() {
  return (
    <div className="flex flex-1 flex-col rounded-xl border border-[#262626] bg-[#1c1c1c] p-5 md:p-6">
      <div className="flex items-center gap-3">
        <img src="/denchat-logo.svg" alt="" className="h-12 w-12 shrink-0" />
        <span className="text-2xl font-bold text-white">DEN Chat</span>
      </div>
      <h3 className="mt-4 text-lg font-bold text-white">Start your own community hub</h3>
      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-neutral-400">
        Running a mod or a community? Spin up your own hub on DEN Chat — decentralized,
        encrypted group chat on Nostr that no one can take down.
      </p>
      <div className="mt-auto flex justify-end pt-4">
        <a
          href={DENCHAT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
        >
          Create a hub on DEN Chat <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  )
}

// A far-future created_at shouldn't win "newest" — ignore anything dated beyond a
// day ahead (clock skew allowance).
const futureCutoff = () => Math.floor(Date.now() / 1000) + 86400

function HubCard({ rec }: { rec: HubRec }) {
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
      {hub.banner && (
        <div className="relative aspect-[3/1] w-full bg-[#212121]">
          <BlossomImage src={hub.banner} alt="" className={cn('h-full w-full object-cover', hideMedia && 'blur-lg')} />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2.5">
          {hub.icon ? (
            <BlossomImage src={hub.icon} alt="" className={cn('h-9 w-9 shrink-0 rounded-lg object-cover', hideMedia && 'blur-md')} />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
              <Hash className="h-4 w-4" />
            </span>
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

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
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
                onClick={() => setOpenOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-700"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open hub
              </button>
              <button
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:border-[#404040]"
                aria-label="Copy hub address"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />} Copy
              </button>
            </>
          )}
        </div>
      </div>

      {naddr && <OpenHubModal open={openOpen} onOpenChange={setOpenOpen} naddr={naddr} />}
    </div>
  )
}
