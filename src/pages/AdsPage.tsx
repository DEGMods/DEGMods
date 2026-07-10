import { useState, useEffect } from 'react'
import { Megaphone, Users, Gamepad2, Zap, Send, User, ExternalLink, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { extractAds, ADS_DTAG, type AdEntry } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { BlossomImage } from '@/components/shared/BlossomImage'

const reasons = [
  {
    icon: Gamepad2,
    title: 'Reach Gamers',
    desc: 'Connect with an active community of gamers who are passionate about modding and customizing their experience.',
  },
  {
    icon: Users,
    title: 'Mod Creators',
    desc: 'Get in front of talented mod creators who build tools, assets, and content for popular games.',
  },
  {
    icon: Zap,
    title: 'Decentralized Community',
    desc: 'Engage with a privacy-conscious, tech-savvy audience that values open protocols and user ownership.',
  },
]

function AdCard({ ad }: { ad: AdEntry }) {
  const buttons = ad.buttons.filter(b => b.text.trim() && b.link.trim())
  return (
    <div className="overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c] shadow-md shadow-black/20">
      <div className="relative aspect-[16/7] w-full bg-gradient-to-br from-purple-900/40 to-[#212121]">
        {ad.banner && <BlossomImage src={ad.banner} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="p-4">
        <div className="flex items-center gap-3">
          {ad.profilePic ? (
            <BlossomImage src={ad.profilePic} alt="" className="h-10 w-10 shrink-0 rounded-full border border-[#262626] object-cover" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#212121] text-neutral-500">
              <User className="h-5 w-5" />
            </div>
          )}
          {ad.name && <p className="min-w-0 truncate font-semibold text-white">{ad.name}</p>}
        </div>
        {ad.description && <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{ad.description}</p>}
        {buttons.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {buttons.map((b, i) => (
              <a
                key={i}
                href={b.link.startsWith('http') ? b.link : `https://${b.link}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-700"
              >
                {b.text}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function AdsPage() {
  const [ads, setAds] = useState<AdEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const event = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [ADS_DTAG] })
        if (!cancelled) setAds(event ? extractAds(event) : [])
      } catch {
        if (!cancelled) setAds([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="mx-auto space-y-12 py-12">
      {/* Live ads */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Megaphone size={28} className="text-purple-400" />
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Ads</h1>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : ads.length === 0 ? (
          <p className="py-6 text-sm text-neutral-500">No ads running right now.</p>
        ) : (
          <div className="grid grid-cols-1 gap-5 xs:grid-cols-2 sm:grid-cols-3">
            {ads.map((ad, i) => <AdCard key={i} ad={ad} />)}
          </div>
        )}
      </section>

      {/* Why Advertise */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold">Why Advertise?</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {reasons.map((item) => (
            <div
              key={item.title}
              className={cn(
                'rounded-xl border border-[#262626] bg-[#1c1c1c] p-6 space-y-3',
                'hover:border-purple-600/50 transition-colors'
              )}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-600/20">
                <item.icon size={20} className="text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold">{item.title}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section
        className={cn(
          'rounded-xl border border-dashed border-[#262626] bg-[#1c1c1c] p-8',
          'flex flex-col items-center gap-4 text-center'
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-600/20">
          <Send size={24} className="text-purple-400" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">Interested?</h3>
          <p className="text-sm text-neutral-400">
            Reach out via Nostr to discuss advertising opportunities. Contact details and an ad
            submission flow will be available here soon.
          </p>
        </div>
      </section>
    </div>
  )
}
