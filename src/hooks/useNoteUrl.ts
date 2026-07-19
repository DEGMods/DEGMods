import { useEffect } from 'react'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { useSettingsStore } from '@/stores/settingsStore'
import { useDnnStore } from '@/stores/dnnStore'
import { shareableShortAddress, shortCodeOf } from '@/lib/nostr/nipShort'

/**
 * The best address for a note: its NIP-SHORT one if it has a code, else an
 * nevent. A verified DNN ID is preferred as authority — that's where the short
 * form actually earns its name.
 */
export async function noteAddress(event: NostrEvent): Promise<string> {
  const nevent = nip19.neventEncode({ id: event.id, author: event.pubkey })
  if (!shortCodeOf(event)) return nevent
  try {
    const dnnId = useDnnStore.getState().getVerifiedDnnId(event.pubkey)
    const authority = dnnId || nip19.npubEncode(event.pubkey)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    return (await shareableShortAddress(relays, event, authority)) || nevent
  } catch {
    return nevent
  }
}

/**
 * Give an open note its own URL, and take it back when the note closes.
 *
 * A note lives in a modal rather than a page, so without this the address bar
 * still says /feed and there's nothing to copy or reload. Restores whatever the
 * URL was on close, so opening a note from notifications returns you to
 * notifications rather than stranding you on the note's address.
 */
export function useNoteUrl(open: boolean, event: NostrEvent | null | undefined) {
  useEffect(() => {
    if (!open || !event) return
    const previous = window.location.pathname + window.location.search
    let cancelled = false

    noteAddress(event).then((address) => {
      if (cancelled) return
      const next = `/feed/note/${address}`
      if (window.location.pathname !== next) window.history.replaceState(null, '', next)
    })

    return () => {
      cancelled = true
      // Only restore if we're still on a note URL — a real navigation while the
      // modal was open should win over putting the old path back.
      if (window.location.pathname.startsWith('/feed/note/')) {
        window.history.replaceState(null, '', previous)
      }
    }
  }, [open, event])
}
