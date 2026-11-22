import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { extractBounty, bountyCoordinateFromNaddr } from '@/lib/nostr/bounty'
import { KINDS } from '@/lib/constants'
import { nip19 } from 'nostr-tools'
import { cn } from '@/lib/utils'

const MAX_NADDR = 300

type Resolved =
  | { state: 'idle' }
  | { state: 'invalid'; message: string }
  | { state: 'loading' }
  | { state: 'notfound' }
  | { state: 'ok'; title: string; game: string; fulfilled: boolean }

/**
 * The "fulfils a bounty" naddr field: validates the pasted bounty address, fetches
 * the bounty, and shows its title + game + status. Warns when the bounty's game
 * doesn't match this mod's game — the publish guard enforces the match, this is the
 * early heads-up.
 */
export function BountyFulfillmentField({
  value,
  onChange,
  modGame,
  inputClass,
}: {
  value: string
  onChange: (v: string) => void
  modGame: string
  inputClass?: string
}) {
  const [resolved, setResolved] = useState<Resolved>({ state: 'idle' })

  const reqRef = useRef(0)
  useEffect(() => {
    const raw = value.trim()
    if (!raw) { setResolved({ state: 'idle' }); return }

    const coord = bountyCoordinateFromNaddr(raw)
    if (!coord) { setResolved({ state: 'invalid', message: 'Not a valid mod bounty address.' }); return }

    const reqId = ++reqRef.current
    setResolved({ state: 'loading' })
    const timer = setTimeout(() => {
      const decoded = nip19.decode(raw) // safe: bountyCoordinateFromNaddr already validated
      if (decoded.type !== 'naddr') return
      const { pubkey, identifier } = decoded.data
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      fetchLatestEvent(relays, { kinds: [KINDS.BOUNTY], authors: [pubkey], '#d': [identifier] })
        .then((ev) => {
          if (reqId !== reqRef.current) return
          const bounty = ev ? extractBounty(ev) : null
          if (!bounty) { setResolved({ state: 'notfound' }); return }
          setResolved({ state: 'ok', title: bounty.title, game: bounty.game, fulfilled: bounty.fulfilled })
        })
        .catch(() => { if (reqId === reqRef.current) setResolved({ state: 'notfound' }) })
    }, 450)
    return () => clearTimeout(timer)
  }, [value])

  const over = value.length > MAX_NADDR
  const mismatch =
    resolved.state === 'ok' && !!modGame.trim() && !!resolved.game && resolved.game !== modGame.trim()

  return (
    <div className="space-y-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste the mod bounty address (naddr1…)"
        className={cn(inputClass, 'font-mono text-xs')}
      />
      <div className="flex items-center justify-between text-xs">
        <div className="min-h-[1rem]">
          {resolved.state === 'loading' && (
            <span className="inline-flex items-center gap-1.5 text-neutral-500"><Loader2 className="h-3 w-3 animate-spin" /> Looking up bounty…</span>
          )}
          {resolved.state === 'invalid' && (
            <span className="inline-flex items-center gap-1.5 text-red-400"><AlertCircle className="h-3 w-3" /> {resolved.message}</span>
          )}
          {resolved.state === 'notfound' && (
            <span className="inline-flex items-center gap-1.5 text-amber-400"><AlertCircle className="h-3 w-3" /> Bounty not found on your relays.</span>
          )}
          {resolved.state === 'ok' && (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {mismatch ? <AlertCircle className="h-3 w-3 text-red-400" /> : <CheckCircle2 className="h-3 w-3 text-[#fc4462]" />}
              <span className="font-medium text-neutral-200">{resolved.title}</span>
              <span className={cn(mismatch ? 'text-red-400' : 'text-neutral-500')}>· {resolved.game}</span>
              {resolved.fulfilled && <span className="text-amber-400">· already fulfilled</span>}
              {mismatch && <span className="text-red-400">· game must match this mod ({modGame.trim()})</span>}
            </span>
          )}
        </div>
        <span className={cn('shrink-0 tabular-nums', over ? 'text-red-400' : 'text-neutral-600')}>{value.length}/{MAX_NADDR}</span>
      </div>
    </div>
  )
}
