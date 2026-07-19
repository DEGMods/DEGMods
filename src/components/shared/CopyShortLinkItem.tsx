import { useState } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Event as NostrEvent } from 'nostr-tools'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useSettingsStore } from '@/stores/settingsStore'
import { shareableShortAddress } from '@/lib/nostr/nipShort'

/**
 * Copies a NIP-SHORT link for an event.
 *
 * Resolving the address needs a relay round-trip — not to build it, but to see
 * whether the author has another event on the same code, which is what decides
 * if a disambiguating suffix is needed. So the item shows a spinner rather than
 * copying instantly.
 */
export function CopyShortLinkItem({ event, basePath }: { event: NostrEvent; basePath: string }) {
  const [busy, setBusy] = useState(false)

  const copy = async (e: Event | React.SyntheticEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const address = await shareableShortAddress(relays, event)
      if (!address) { toast.error('This post has no short link yet'); return }
      await navigator.clipboard.writeText(`${window.location.origin}${basePath}/${address}`)
      toast.success('Short link copied')
    } catch {
      toast.error('Couldn’t copy the short link')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenuItem onSelect={copy} className="cursor-pointer">
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
      Copy Short Link
    </DropdownMenuItem>
  )
}
