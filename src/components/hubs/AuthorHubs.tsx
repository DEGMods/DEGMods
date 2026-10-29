import { useState, useEffect } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAuthStore } from '@/stores/authStore'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { parseHubRecommendations, HUB_RECOMMENDATIONS_DTAG, type HubRec } from '@/lib/nostr/hubs'
import { HubCard } from '@/components/hubs/HubCard'
import { ManageHubsModal } from '@/components/hubs/ManageHubsModal'

const NIP78_KIND = 30078

/**
 * A creator's own recommended community hub.
 *
 * Reads THIS author's recommended-hubs list (same NIP-78 d-tag as the site's, but
 * authored by the creator rather than the site admin) and shows their first
 * (priority) hub. When they haven't recommended any, it says so — an explicit
 * empty state rather than a blank gap, like the per-author blog-posts section.
 *
 * On the creator's OWN profile (`allowManage` + signed in as them), a pen button
 * opens a modal to add / reorder their hubs.
 */
export function AuthorHubs({ pubkey, allowManage = false }: { pubkey: string; allowManage?: boolean }) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const canManage = allowManage && !!myPubkey && myPubkey === pubkey
  const [recs, setRecs] = useState<HubRec[] | null>(null) // null = still loading
  const [manageOpen, setManageOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0) // bumped to re-fetch after a publish

  useEffect(() => {
    let cancelled = false
    setRecs(null)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchEvent(relays, { kinds: [NIP78_KIND], authors: [pubkey], '#d': [HUB_RECOMMENDATIONS_DTAG] })
      .then((ev) => { if (!cancelled) setRecs(parseHubRecommendations(ev)) })
      .catch(() => { if (!cancelled) setRecs([]) })
    return () => { cancelled = true }
  }, [pubkey, reloadKey])

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-200">
        <img src="/denchat-logo.svg" alt="" className="h-5 w-5" />
        <span className="flex-1">Community hub</span>
        {canManage && (
          <button
            onClick={() => setManageOpen(true)}
            className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-[#262626] hover:text-neutral-200"
            aria-label="Manage your community hubs"
            title="Manage your community hubs"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </h2>

      {recs === null ? (
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : recs.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {canManage
            ? 'You haven’t recommended a community hub yet.'
            : 'This creator hasn’t recommended a community hub yet.'}
        </p>
      ) : (
        <HubCard rec={recs[0]} />
      )}

      {canManage && (
        <ManageHubsModal
          open={manageOpen}
          onOpenChange={setManageOpen}
          onPublished={() => { setManageOpen(false); setReloadKey((k) => k + 1) }}
        />
      )}
    </section>
  )
}
