import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { Loader2, AlertTriangle, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settingsStore'
import { resolveShortAddress, isCoordinateKind, type ShortResolution } from '@/lib/nostr/nipShort'
import { KINDS } from '@/lib/constants'

/** Where an event lives in this client, or null if we don't render its kind. */
function pathForEvent(event: NostrEvent): string | null {
  const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
  const naddr = () => nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: d })
  try {
    switch (event.kind) {
      case KINDS.MOD: return `/mod/${naddr()}`
      case KINDS.BLOG: return `/blog/${naddr()}`
      case KINDS.JAM: return `/mod-jam/${naddr()}`
      // Notes and comments have no page of their own; the feed opens them in a
      // thread modal, so send the reader to the author's profile with the note
      // identified rather than nowhere.
      case KINDS.SHORT_NOTE:
      case 1111:
        return `/profile/${nip19.npubEncode(event.pubkey)}?note=${nip19.noteEncode(event.id)}`
      default:
        return isCoordinateKind(event.kind) ? null : null
    }
  } catch {
    return null
  }
}

/**
 * Resolves a NIP-SHORT address and forwards to whatever it points at.
 *
 * Mounted at an explicit `/s/:address` rather than a catch-all: a short address
 * begins with `s` and so would shadow `/settings`, `/submit-mod` and friends if
 * matched loosely.
 */
export function ShortAddressPage() {
  const { address } = useParams<{ address: string }>()
  const navigate = useNavigate()
  const [result, setResult] = useState<ShortResolution | null>(null)

  useEffect(() => {
    if (!address) return
    let cancelled = false
    setResult(null)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    resolveShortAddress(relays, address)
      .then((r) => {
        if (cancelled) return
        if (r.status === 'resolved') {
          const path = pathForEvent(r.event)
          if (path) { navigate(path, { replace: true }); return }
        }
        setResult(r)
      })
      .catch(() => { if (!cancelled) setResult({ status: 'not-found' }) })
    return () => { cancelled = true }
  }, [address, navigate])

  if (!result) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-neutral-400">
        <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
        <p className="text-sm">Resolving <span className="font-mono text-neutral-300">{address}</span>…</p>
      </div>
    )
  }

  if (result.status === 'ambiguous') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-xl font-semibold text-white">This address matches more than one post</h1>
        <p className="mt-2 text-sm text-neutral-400">
          The author has several events on this code. Pick the one you meant — a longer address
          would point at it directly.
        </p>
        <ul className="mt-6 space-y-2">
          {result.candidates.map((e) => {
            const path = pathForEvent(e)
            const title = e.tags.find((t) => t[0] === 'title')?.[1]
            const label = title || e.content.slice(0, 80) || `kind ${e.kind}`
            return (
              <li key={e.id}>
                {path ? (
                  <Link to={path} className="block rounded-lg border border-[#262626] bg-[#1c1c1c] px-4 py-3 text-sm text-neutral-200 transition-colors hover:border-purple-500/40">
                    {label}
                    <span className="mt-1 block text-xs text-neutral-500">{new Date(e.created_at * 1000).toLocaleString()}</span>
                  </Link>
                ) : (
                  <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] px-4 py-3 text-sm text-neutral-500">
                    {label} <span className="text-xs">(kind {e.kind} — not shown in this client)</span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  const message = result.status === 'bad-address'
    ? "That doesn't look like a short address."
    : "Nothing found for this address on your relays."

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <AlertTriangle className="h-10 w-10 text-neutral-500" />
      <div>
        <h1 className="text-xl font-semibold text-white">Can’t open this link</h1>
        <p className="mt-1 text-sm text-neutral-400">{message}</p>
        <p className="mt-1 font-mono text-xs text-neutral-600">{address}</p>
      </div>
      <Button variant="outline" className="gap-1.5 border-[#262626]" onClick={() => navigate('/')}>
        <ChevronLeft className="h-4 w-4" /> Back home
      </Button>
    </div>
  )
}
