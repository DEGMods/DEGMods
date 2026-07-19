import { Fragment } from 'react'
import { nip19 } from 'nostr-tools'
import { HubEventCard, HUB_KIND } from '@/components/social/HubEventCard'

const NADDR_RE = /(?:nostr:)?(naddr1[0-9a-z]+)/gi

/**
 * A DM's text, with DEN Chat hub links rendered as cards.
 *
 * Deliberately narrow: only hub addresses become rich, everything else stays
 * plain text. Running DM content through the full note renderer would auto-load
 * remote images, and a fetch to someone else's server is a read receipt the
 * sender never asked for and the reader didn't consent to.
 */
export function DmContent({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  NADDR_RE.lastIndex = 0

  while ((match = NADDR_RE.exec(text)) !== null) {
    let hub: { identifier: string; pubkey: string } | null = null
    try {
      const d = nip19.decode(match[1])
      if (d.type === 'naddr' && d.data.kind === HUB_KIND) {
        hub = { identifier: d.data.identifier, pubkey: d.data.pubkey }
      }
    } catch { /* not a usable address — leave the text alone */ }
    if (!hub) continue

    if (match.index > last) parts.push(<Fragment key={`t${last}`}>{text.slice(last, match.index)}</Fragment>)
    parts.push(<HubEventCard key={`h${match.index}`} identifier={hub.identifier} pubkey={hub.pubkey} />)
    last = match.index + match[0].length
  }

  if (parts.length === 0) return <>{text}</>
  if (last < text.length) parts.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>)
  return <>{parts}</>
}
