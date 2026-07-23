import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { HandCoins, ExternalLink, Loader2, Heart } from 'lucide-react'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { extractSupporters, SUPPORTERS_DTAG, type FundingCampaign, type Supporter } from '@/lib/nostr/events'
import { KINDS, ADMIN_PUBKEY } from '@/lib/constants'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export function SupportersPage() {
  const [campaigns, setCampaigns] = useState<FundingCampaign[]>([])
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const event = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [SUPPORTERS_DTAG] })
        if (cancelled) return
        const parsed = event ? extractSupporters(event) : []
        setCampaigns(parsed)

        // One batched pass over every pubkeyed supporter, deduped and cached by
        // the user store, so a person appearing in several tiers is fetched once.
        const pubkeys = [...new Set(
          parsed.flatMap(c => c.tiers.flatMap(t => t.supporters.map(s => s.pubkey).filter((p): p is string => !!p))),
        )]
        const map = new Map<string, UserProfile>()
        await Promise.allSettled(pubkeys.map(async (pk) => {
          const p = await useUserStore.getState().fetchProfile(pk, relays)
          if (p) map.set(pk, p)
        }))
        if (!cancelled) setProfiles(map)
      } catch {
        /* leave empty — the empty state covers it */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const hasAny = useMemo(
    () => campaigns.some(c => c.tiers.some(t => t.supporters.length > 0)),
    [campaigns],
  )

  return (
    <div className="mx-auto space-y-10 py-12">
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <HandCoins size={28} className="text-purple-400" />
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Supporters</h1>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-neutral-400">
          The people who funded DEG Mods. Thank you.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading supporters…
        </div>
      ) : !hasAny ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Heart className="h-10 w-10 text-neutral-700" />
          <p className="text-sm text-neutral-500">No supporters listed yet.</p>
        </div>
      ) : (
        campaigns
          .filter(c => c.tiers.some(t => t.supporters.length > 0))
          .map((campaign, ci) => (
            <section key={ci} className="space-y-6">
              <div className="flex items-center gap-3 border-b border-[#262626] pb-3">
                <h2 className="text-2xl font-semibold">{campaign.name || 'Funding campaign'}</h2>
                {campaign.url && (
                  <a
                    href={campaign.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300"
                  >
                    View campaign <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>

              {campaign.tiers
                .filter(t => t.supporters.length > 0)
                .map((tier, ti) => (
                  <div key={ti} className="space-y-3">
                    {tier.name && (
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-purple-300">{tier.name}</h3>
                    )}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {tier.supporters.map((s, si) => (
                        <SupporterCard key={si} supporter={s} profile={s.pubkey ? profiles.get(s.pubkey) : undefined} />
                      ))}
                    </div>
                  </div>
                ))}
            </section>
          ))
      )}
    </div>
  )
}

function SupporterCard({ supporter, profile }: { supporter: Supporter; profile?: UserProfile }) {
  const hasIdentity = !!supporter.pubkey
  const npub = supporter.pubkey ? nip19.npubEncode(supporter.pubkey) : ''
  // kind:0 name for an identity; the typed name otherwise; short npub as last resort.
  const displayName = hasIdentity
    ? (profile?.display_name || profile?.name || `${npub.slice(0, 12)}…`)
    : (supporter.name || 'Anonymous')
  const picture = hasIdentity ? profile?.picture : undefined

  const inner = (
    <div
      className={cn(
        'flex h-full flex-col items-center gap-3 rounded-xl border border-[#262626] bg-[#1c1c1c] p-5 text-center',
        hasIdentity && 'transition-colors hover:border-[#404040]',
      )}
    >
      <Avatar className="h-16 w-16">
        {picture ? <AvatarImage src={picture} alt={displayName} /> : null}
        <AvatarFallback className="bg-[#212121] text-neutral-500">
          {displayName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="line-clamp-2 text-sm font-medium text-neutral-100">{displayName}</span>
      {supporter.amount && (
        <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-xs font-semibold text-purple-300">
          {supporter.amount}
        </span>
      )}
    </div>
  )

  return hasIdentity ? (
    <Link to={`/profile/${npub}`} className="block h-full">{inner}</Link>
  ) : (
    inner
  )
}
