import { Fragment, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { ImageIcon, Film, Music, ExternalLink } from 'lucide-react'
import { HubEventCard, HUB_KIND } from '@/components/social/HubEventCard'
import { classifyMediaUrl } from '@/components/social/NoteContent'

const TOKEN_RE = /(https?:\/\/[^\s]+)|(?:nostr:)?(naddr1[0-9a-z]+)/gi

/**
 * Media in a DM, behind a click.
 *
 * Loading it fetches from someone else's server, and in a private conversation
 * that request is a read receipt — it tells whoever hosts the file, and anyone
 * who can see the sender's logs, that this message was opened and roughly when.
 * A public post carries no such expectation; a DM does. So the reader decides.
 */
function Attachment({ url }: { url: string }) {
  const kind = classifyMediaUrl(url)
  const [show, setShow] = useState(false)

  if (kind === 'link') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="break-all text-purple-300 underline decoration-purple-300/40 underline-offset-2 hover:text-purple-200"
      >
        {url}
      </a>
    )
  }

  if (!show) {
    const Icon = kind === 'video' ? Film : kind === 'audio' ? Music : ImageIcon
    const label = kind === 'video' ? 'Show video' : kind === 'audio' ? 'Play audio' : 'Show image'
    return (
      <span className="my-1 block">
        <button
          onClick={() => setShow(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/20 px-2.5 py-1.5 text-[11px] transition-colors hover:border-white/30"
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {label}
          <span className="opacity-60">· loads from {hostOf(url)}</span>
        </button>
      </span>
    )
  }

  if (kind === 'video') {
    return <video src={url} controls className="my-1 max-h-80 w-full rounded-lg" />
  }
  if (kind === 'audio') {
    return <audio src={url} controls className="my-1 w-full" />
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="my-1 block">
      <img src={url} alt="" className="max-h-80 rounded-lg object-contain" />
    </a>
  )
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return 'another site' }
}

/**
 * A DM's text, with hub links rendered as cards and media offered as
 * attachments. Everything else stays plain text.
 */
export function DmContent({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0

  const pushText = (upto: number) => {
    if (upto > last) parts.push(<Fragment key={`t${last}`}>{text.slice(last, upto)}</Fragment>)
  }

  while ((match = TOKEN_RE.exec(text)) !== null) {
    const [raw, url, bech] = match

    if (url) {
      pushText(match.index)
      parts.push(<Attachment key={`u${match.index}`} url={url} />)
      last = match.index + raw.length
      continue
    }

    if (bech) {
      try {
        const d = nip19.decode(bech)
        if (d.type === 'naddr' && d.data.kind === HUB_KIND) {
          pushText(match.index)
          parts.push(<HubEventCard key={`h${match.index}`} identifier={d.data.identifier} pubkey={d.data.pubkey} />)
          last = match.index + raw.length
        }
      } catch { /* not a usable address — leave it as text */ }
    }
  }

  if (parts.length === 0) return <>{text}</>
  pushText(text.length)
  return <>{parts}</>
}
