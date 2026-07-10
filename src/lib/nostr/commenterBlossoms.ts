/**
 * commenterBlossoms — last-resort download failover source.
 *
 * When a mod's download can't be recovered from the original link or any of the
 * viewer's own Blossom servers, we widen the search to the Blossom servers
 * published (kind 10063) by users who commented on that same mod. Content is
 * addressed by SHA-256, so any server holding the hash serves the exact file.
 */

import { fetchComments, type NostrTarget } from './social'
import { fetchEvent } from './relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { KINDS } from '@/lib/constants'

/** Cap how many commenters we resolve, to bound relay traffic. */
const MAX_COMMENTERS = 30

/**
 * Blossom server URLs from the published lists of everyone who commented on the
 * given mod, deduplicated. Empty if nobody commented or none published a list.
 */
export async function collectCommenterBlossomServers(root: NostrTarget): Promise<string[]> {
  const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
  const comments = await fetchComments(relays, root)

  const pubkeys = [...new Set(comments.map((c) => c.pubkey))].slice(0, MAX_COMMENTERS)
  if (pubkeys.length === 0) return []

  const lists = await Promise.all(
    pubkeys.map((pk) =>
      fetchEvent(relays, { kinds: [KINDS.BLOSSOM_LIST], authors: [pk] }, 5000).catch(() => null),
    ),
  )

  const seen = new Set<string>()
  const servers: string[] = []
  for (const ev of lists) {
    for (const t of ev?.tags ?? []) {
      if (t[0] !== 'server' || !t[1]) continue
      const key = t[1].replace(/\/+$/, '')
      if (!seen.has(key)) { seen.add(key); servers.push(t[1]) }
    }
  }
  return servers
}
