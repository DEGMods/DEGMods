import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'

export type RefKind = 'naddr' | 'link' | 'text'

/** Classify a free-form mod reference: a DEG MODS naddr, an external link, or plain text. */
export function classifyRef(value: string): RefKind {
  const v = value.trim().replace(/^nostr:/i, '')
  if (/^naddr1[0-9a-z]+$/i.test(v)) return 'naddr'
  if (/^https?:\/\//i.test(v)) return 'link'
  return 'text'
}

const base = 'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors'
const TONES = {
  default: 'border-[#262626] bg-[#212121] text-neutral-200 hover:border-[#404040] hover:text-white',
  accent: 'border-purple-500/40 bg-purple-500/15 text-purple-100 hover:bg-purple-500/25',
} as const

/**
 * Renders a mod reference appropriately:
 * - naddr → a "View mod" button that opens it on DEG MODS
 * - link  → a button that opens the URL in a new tab
 * - text  → plain text (e.g. a mod name)
 */
export function ModRefValue({ value, viewLabel = 'View mod', tone = 'default' }: {
  value: string
  viewLabel?: string
  tone?: keyof typeof TONES
}) {
  const v = value.trim()
  const kind = classifyRef(v)
  const cls = `${base} ${TONES[tone]}`

  if (kind === 'naddr') {
    return (
      <Link to={`/mod/${v.replace(/^nostr:/i, '')}`} className={cls}>
        <ExternalLink className="h-3.5 w-3.5" /> {viewLabel}
      </Link>
    )
  }
  if (kind === 'link') {
    return (
      <a href={v} target="_blank" rel="noopener noreferrer" className={cls}>
        <ExternalLink className="h-3.5 w-3.5" /> Open link
      </a>
    )
  }
  return <span className="text-neutral-300">{v}</span>
}
