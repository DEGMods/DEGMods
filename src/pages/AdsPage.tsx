import { useState, useEffect } from 'react'
import { Megaphone, Users, Gamepad2, Zap, Send, User, ExternalLink, Loader2, MapPin, BarChart3, Tag, AlertTriangle, Home, Newspaper, Download, Sparkles, Network } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { extractAds, ADS_DTAG, type AdEntry } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { BlossomImage } from '@/components/shared/BlossomImage'
import { Button } from '@/components/ui/button'
import { ContactModal } from '@/components/shared/ContactModal'

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

const placements = [
  { icon: Home, title: 'Landing page', desc: 'At the bottom of the home page.' },
  { icon: Newspaper, title: 'Mod & blog posts', desc: 'In the sidebar, at the bottom of the post.' },
  {
    icon: Download,
    title: 'Download gate',
    desc: 'A popup shown while a user downloads a mod hosted on our servers. If a download is served from a third-party server rather than ours, no ad is shown.',
  },
  {
    icon: Sparkles,
    title: 'Ads page',
    desc: "This page itself. Some people browse it directly, because the lineup is hand-picked by the DEG Mods team. We don't run ads unrelated to our industry, so what appears here tends to be genuinely relevant to whoever seeks it out.",
  },
  {
    icon: Network,
    title: 'DEG Mods Network',
    desc: 'Other mod creators and hubs that run this software unmodified show the same spots (download gates and similar placements) on their own sites, so a placement can reach beyond DEG Mods across the wider network.',
  },
]

/**
 * Stated as minimums, and lower than the raw dashboard numbers on purpose.
 *
 * The previous figures came from the old site, which counted a fresh page view
 * every time a filter changed the URL. Those are the same person on the same
 * page, so they're removed here — measured per path against the analytics
 * export rather than estimated: /search churned 97%, /mods 41%, and the /game/*
 * listings 55–72%, while mod and blog post pages churned 0.1% because nothing
 * on them rewrites the URL. That's ~31% of all views removed. Visitor counts are
 * untouched: a repeat view can't invent a session.
 *
 * They're minimums because several real readers are never counted at all —
 * ad-blockers, scripts disabled, the site's own analytics opt-out, and mod pages
 * whose event doesn't resolve from relays in time.
 */
const stats = [
  { value: '≥23K', label: 'Avg. monthly visitors' },
  { value: '≥145K', label: 'Avg. monthly page views' },
  { value: '≥340K', label: 'Total visitors (since launch)' },
  { value: '≥2M', label: 'Total page views (since launch)' },
]

/**
 * Monthly price = CPM × (monthly page views ÷ 1000), shared = that ÷ 4.
 *
 * So these rates are tied to the `stats` figure above and have to move with it:
 * at ≥145K monthly views, $7 → $1,015, listed as $1,000 exclusive / $250 shared.
 * Rounding is deliberately toward the advertiser — the listed price buys
 * slightly more than the CPM demands, never less.
 *
 * The CPMs were $5/$10/$15 against a 203K view count, then $6.25/$12.50/$18.75
 * against 160K. Each correction removed churn the previous figure still carried,
 * so the traffic came down, the rate came up, and the money stayed put. Change
 * one of these and re-derive the other, or an advertiser doing the
 * multiplication finds the page disagreeing with itself.
 */
const tiers = [
  { tier: 'Indie', cpm: '$7.00', shared: '~$250 / mo', exclusive: '~$1,000 / mo' },
  { tier: 'Double-A', cpm: '$14.00', shared: '~$500 / mo', exclusive: '~$2,000 / mo' },
  { tier: 'Triple-A', cpm: '$21.00', shared: '~$750 / mo', exclusive: '~$3,000 / mo' },
]

export function AdCard({ ad }: { ad: AdEntry }) {
  const buttons = ad.buttons.filter(b => b.text.trim() && b.link.trim())
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c] shadow-md shadow-black/20">
      <div className="relative aspect-[16/7] w-full shrink-0 bg-gradient-to-br from-purple-900/40 to-[#212121]">
        {ad.banner && <BlossomImage src={ad.banner} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="flex flex-1 flex-col p-4">
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
        {ad.description && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-neutral-300">{ad.description}</p>}
        {buttons.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-2 pt-3">
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
  const [contactOpen, setContactOpen] = useState(false)

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
          <div className="grid grid-cols-1 gap-5 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {ads.map((ad, i) => <AdCard key={i} ad={ad} />)}
          </div>
        )}
      </section>

      {/* Where your ad appears */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <MapPin size={22} className="text-purple-400" />
          <h2 className="text-2xl font-semibold">Where your ad appears</h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          {placements.map((p) => (
            <div key={p.title} className="rounded-xl border border-[#262626] bg-[#1c1c1c] p-6 space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-600/20">
                <p.icon size={20} className="text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold">{p.title}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Audience & Reach */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <BarChart3 size={22} className="text-purple-400" />
          <h2 className="text-2xl font-semibold">Audience &amp; Reach</h2>
        </div>
        <p className="text-sm leading-relaxed text-neutral-500">
          Site-wide traffic since launch (May 2025 to July 2026), measured with self-hosted Umami.
          Visitors are counted once per day, so a reader who returns on ten days counts ten times —
          these are visits by unique readers, not ten thousand separate people. Figures are stated as
          minimums: readers using ad-blockers, browsers with scripts disabled, or the site&rsquo;s own
          analytics opt-out are never counted. Last updated July 2026.
        </p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-[#262626] bg-[#1c1c1c] p-6 text-center">
              <div className="text-3xl font-bold text-white sm:text-4xl">{s.value}</div>
              <div className="mt-1 text-xs text-neutral-400">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Tag size={22} className="text-purple-400" />
          <h2 className="text-2xl font-semibold">Pricing</h2>
        </div>
        <p className="text-sm text-neutral-400 leading-relaxed">
          Placements are priced on a <span className="font-semibold text-neutral-200">historical CPM</span> (cost
          per 1,000 impressions), per month; your tier depends on your studio. &ldquo;Historical&rdquo; means the
          rate is set against our <span className="font-semibold text-neutral-200">past</span> trailing traffic,
          not against what your ad delivers. By default, a spot is
          <span className="font-semibold text-neutral-200"> shared by up to 4 advertisers in rotation</span>, so the
          monthly cost is the CPM figure divided by 4. A
          <span className="font-semibold text-neutral-200"> full-exclusivity</span> deal takes all 4 shares at the
          full rate.
        </p>

        <div className="overflow-x-auto rounded-xl border border-[#262626]">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-[#212121] text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Tier</th>
                <th className="px-4 py-3 font-medium">Historical CPM</th>
                <th className="px-4 py-3 font-medium">Shared spot (default, &divide;4)</th>
                <th className="px-4 py-3 font-medium">Full exclusivity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#262626]">
              {tiers.map((t) => (
                <tr key={t.tier} className="bg-[#1c1c1c]">
                  <td className="px-4 py-3 font-semibold text-white">{t.tier}</td>
                  <td className="px-4 py-3 text-neutral-300">{t.cpm}</td>
                  <td className="px-4 py-3 text-neutral-300">{t.shared}</td>
                  <td className="px-4 py-3 text-neutral-300">{t.exclusive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs leading-relaxed text-neutral-500">
          Full-exclusivity example: a $7 CPM against our ~145K historical monthly views = $7 &times; (145,000
          &divide; 1,000) = <span className="font-semibold text-neutral-300">$1,015/mo</span>, listed at a flat
          $1,000; the shared default is a quarter of that (
          <span className="font-semibold text-neutral-300">$250/mo</span>). The price is fixed by the historical CPM,
          and it does <span className="font-semibold text-neutral-300">not</span> guarantee 145K impressions. Your ad
          may receive fewer, possibly 70K or less. You pay the flat monthly rate regardless of impressions actually
          delivered.
        </p>

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-500/90">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            <span className="font-semibold">No performance reporting.</span> We don&rsquo;t provide per-ad analytics
            or delivery reports. The figures above are site-wide, not per-placement. Bring your own tracking (e.g.
            UTM-tagged links plus your own analytics) if you need to measure results.
          </p>
        </div>
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
            Tell us about your ad and we will get back to you by email. It sends securely over
            Nostr, no account needed.
          </p>
        </div>
        <Button onClick={() => setContactOpen(true)} className="bg-purple-600 text-white hover:bg-purple-700">
          Get in touch
        </Button>
      </section>

      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} subject="advertisement" lockSubject />
    </div>
  )
}
