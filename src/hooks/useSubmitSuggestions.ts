import { useEffect, useState } from 'react'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import {
  SUGGESTED_TAGS_DTAG, SUGGESTED_CATEGORIES_DTAG,
  extractSuggestedTags, extractSuggestedCategories,
} from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'

/** Admin-published tag & category suggestions for the submit/edit mod page. */
export function useSubmitSuggestions() {
  const [tags, setTags] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [SUGGESTED_TAGS_DTAG] })
      .then(ev => { if (!cancelled && ev) setTags(extractSuggestedTags(ev)) }).catch(() => {})
    fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [SUGGESTED_CATEGORIES_DTAG] })
      .then(ev => { if (!cancelled && ev) setCategories(extractSuggestedCategories(ev)) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  return { tags, categories }
}
