import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { extractJam, jamCoordinateFromNaddr, jamStatus } from '@/lib/nostr/jam'
import { KINDS } from '@/lib/constants'
import { nip19 } from 'nostr-tools'
import { cn } from '@/lib/utils'

const MAX_NADDR = 300

type Resolved =
  | { state: 'idle' }
  | { state: 'invalid'; message: string }
  | { state: 'loading' }
  | { state: 'notfound' }
  | { state: 'ok'; title: string; status: string }

const STATUS_LABEL: Record<string, string> = {
  upcoming: 'Not started yet',
  active: 'Accepting submissions',
  voting: 'Voting in progress',
  ended: 'Ended',
}

/**
 * The "for a mod jam" naddr field: validates the pasted jam address, fetches the
 * jam, and shows its title + status so the submitter knows they linked the right one.
 */
export function JamSubmissionField({
  value,
  onChange,
  inputClass,
}: {
  value: string
  onChange: (v: string) => void
  inputClass?: string
}) {
  const [resolved, setResolved] = useState<Resolved>({ state: 'idle' })

  // Debounce + cancel stale fetches as the field is edited.
  const reqRef = useRef(0)
  useEffect(() => {
    const raw = value.trim()
    if (!raw) { setResolved({ state: 'idle' }); return }

    const coord = jamCoordinateFromNaddr(raw)
    if (!coord) { setResolved({ state: 'invalid', message: 'Not a valid mod jam address.' }); return }

    const reqId = ++reqRef.current
    setResolved({ state: 'loading' })
    const timer = setTimeout(() => {
      const decoded = nip19.decode(raw) // safe: jamCoordinateFromNaddr already validated
      if (decoded.type !== 'naddr') return
      const { pubkey, identifier } = decoded.data
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      fetchLatestEvent(relays, { kinds: [KINDS.JAM], authors: [pubkey], '#d': [identifier] })
        .then((ev) => {
          if (reqId !== reqRef.current) return
          const jam = ev ? extractJam(ev) : null
          if (!jam) { setResolved({ state: 'notfound' }); return }
          setResolved({ state: 'ok', title: jam.title, status: jamStatus(jam, Math.floor(Date.now() / 1000)) })
        })
        .catch(() => { if (reqId === reqRef.current) setResolved({ state: 'notfound' }) })
    }, 450)
    return () => clearTimeout(timer)
  }, [value])

  const over = value.length > MAX_NADDR

  return (
    <div className="space-y-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste the mod jam address (naddr1…)"
        className={cn(inputClass, 'font-mono text-xs')}
      />
      <div className="flex items-center justify-between text-xs">
        <div className="min-h-[1rem]">
          {resolved.state === 'loading' && (
            <span className="inline-flex items-center gap-1.5 text-neutral-500"><Loader2 className="h-3 w-3 animate-spin" /> Looking up jam…</span>
          )}
          {resolved.state === 'invalid' && (
            <span className="inline-flex items-center gap-1.5 text-red-400"><AlertCircle className="h-3 w-3" /> {resolved.message}</span>
          )}
          {resolved.state === 'notfound' && (
            <span className="inline-flex items-center gap-1.5 text-amber-400"><AlertCircle className="h-3 w-3" /> Jam not found on your relays.</span>
          )}
          {resolved.state === 'ok' && (
            <span className="inline-flex items-center gap-1.5 text-[#fc4462]">
              <CheckCircle2 className="h-3 w-3" />
              <span className="font-medium text-neutral-200">{resolved.title}</span>
              <span className="text-neutral-500">· {STATUS_LABEL[resolved.status] ?? resolved.status}</span>
            </span>
          )}
        </div>
        <span className={cn('shrink-0 tabular-nums', over ? 'text-red-400' : 'text-neutral-600')}>{value.length}/{MAX_NADDR}</span>
      </div>
    </div>
  )
}
