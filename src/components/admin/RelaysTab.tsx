import { useState, useEffect, useCallback } from 'react'
import { Loader2, Ban, X, RefreshCw, AlertTriangle, Trash2, Search } from 'lucide-react'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fetchAllEvents } from '@/lib/nostr/relay-pool'
import { KINDS } from '@/lib/constants'
import {
  MANAGED_RELAYS, listBannedPubkeys, banPubkey, allowPubkey,
  banEventKey, listBannedEvents, unbanEvent, eventBanKey, wsToHttp,
  type BannedPubkey, type BannedEventEntry,
} from '@/lib/blossom/adminApi'

const LEGACY_MOD_KIND = 30402

/** Accepts npub or hex, returns hex ("" if invalid). */
function toHex(input: string): string {
  const v = input.trim()
  if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase()
  if (v.startsWith('npub1')) {
    try {
      const d = nip19.decode(v)
      if (d.type === 'npub') return d.data
    } catch { /* invalid */ }
  }
  return ''
}

function toNpub(hex: string): string {
  try {
    const npub = nip19.npubEncode(hex)
    return npub.slice(0, 16) + '…' + npub.slice(-8)
  } catch {
    return hex.slice(0, 12) + '…'
  }
}

export function RelaysTab() {
  const [relay, setRelay] = useState(MANAGED_RELAYS[0].url)
  const [bannedVersion, setBannedVersion] = useState(0)
  const bumpBanned = () => setBannedVersion((v) => v + 1)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-neutral-400">Relay</label>
        <select
          value={relay}
          onChange={(e) => setRelay(e.target.value)}
          className="rounded-md border border-[#262626] bg-[#1c1c1c] px-2.5 py-1.5 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
        >
          {MANAGED_RELAYS.map((n) => (
            <option key={n.url} value={n.url}>{n.label}</option>
          ))}
        </select>
      </div>

      <BannedPubkeys relay={relay} />
      <EventModeration relay={relay} onChanged={bumpBanned} />
      <BannedEventsList relay={relay} version={bannedVersion} onChanged={bumpBanned} />
    </div>
  )
}

// ─── Event moderation (mod-event takedowns) ─────────────────────────

function tagVal(e: NostrEvent, name: string): string {
  return e.tags.find((t) => t[0] === name)?.[1] ?? ''
}

function EventModeration({ relay, onChanged }: { relay: string; onChanged?: () => void }) {
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const evs = await fetchAllEvents([relay], { kinds: [KINDS.MOD, LEGACY_MOD_KIND] }, { timeoutMs: 8000 })
      evs.sort((a, b) => b.created_at - a.created_at)
      setEvents(evs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events')
    } finally {
      setLoading(false)
    }
  }, [relay])

  useEffect(() => { load() }, [load])

  const remove = async (e: NostrEvent) => {
    setBusyId(e.id)
    try {
      await banEventKey(wsToHttp(relay), eventBanKey(e))
      toast.success('Taken down — re-publishing the same mod is now blocked')
      setEvents((prev) => prev.filter((x) => x.id !== e.id))
      setConfirmId(null)
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Takedown failed')
    } finally {
      setBusyId(null)
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? events.filter((e) => tagVal(e, 'title').toLowerCase().includes(q) || e.pubkey.includes(q) || tagVal(e, 'd').toLowerCase().includes(q))
    : events

  return (
    <section className="rounded-xl border border-[#262626] bg-[#171717] p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-200">Mod events{events.length ? ` (${events.length})` : ''}</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={load} className="text-neutral-500 hover:text-neutral-300">
              <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        Remove a mod event from this relay (takedown). A determined author can re-publish it — ban the
        pubkey above for a persistent block.
      </p>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, d-tag, or author…"
          className="w-full rounded-md border border-[#262626] bg-[#1c1c1c] py-2 pl-9 pr-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
        </div>
      )}
      {loading && events.length === 0 && <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />}

      <ul className="divide-y divide-[#1f1f1f]">
        {filtered.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-neutral-200">
                {tagVal(e, 'title') || tagVal(e, 'd') || '(untitled)'}
                {e.kind === LEGACY_MOD_KIND && <span className="ml-1.5 text-[10px] text-yellow-500/70">legacy</span>}
              </p>
              <p className="truncate text-[11px] text-neutral-500">
                {shortNpub(e.pubkey)} · {new Date(e.created_at * 1000).toLocaleDateString()}
              </p>
            </div>
            {confirmId === e.id ? (
              <div className="flex flex-shrink-0 items-center gap-1">
                <Button onClick={() => remove(e)} disabled={busyId === e.id} className="h-7 bg-red-600 px-2 text-xs text-white hover:bg-red-700">
                  {busyId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirm'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmId(null)} className="h-7 px-2 text-xs text-neutral-400">Cancel</Button>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setConfirmId(e.id)}
                    className="flex-shrink-0 rounded p-1.5 text-neutral-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Remove from relay</TooltipContent>
              </Tooltip>
            )}
          </li>
        ))}
      </ul>
      {!loading && filtered.length === 0 && !error && (
        <p className="text-xs text-neutral-600">No mod events{q ? ' match your search' : ' on this relay'}.</p>
      )}
    </section>
  )
}

// ─── Taken-down (banned) events ─────────────────────────────────────

function parseBanKey(key: string): { label: string; sub?: string } {
  const parts = key.split(':')
  if (parts.length >= 3) {
    return { label: parts.slice(2).join(':') || '(no slug)', sub: `${shortNpub(parts[1])} · kind ${parts[0]}` }
  }
  return { label: key.slice(0, 18) + '…' }
}

function BannedEventsList({ relay, version, onChanged }: { relay: string; version: number; onChanged?: () => void }) {
  const [list, setList] = useState<BannedEventEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setList(await listBannedEvents(wsToHttp(relay)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setList(null)
    }
  }, [relay])

  useEffect(() => { load() }, [load, version])

  const unban = async (key: string) => {
    setBusy(key)
    try {
      await unbanEvent(wsToHttp(relay), key)
      toast.success('Un-banned — this mod can be published again')
      onChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Un-ban failed')
    } finally {
      setBusy(null)
    }
  }

  if (!error && (!list || list.length === 0)) return null // hidden unless there are takedowns

  return (
    <section className="rounded-xl border border-[#262626] bg-[#171717] p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-200">Taken-down events{list ? ` (${list.length})` : ''}</h3>
      <p className="mb-3 text-xs text-neutral-500">
        These addresses are blocked — the relay auto-rejects any re-publish. Un-ban to allow them again.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <ul className="divide-y divide-[#1f1f1f]">
        {list?.map((b) => {
          const p = parseBanKey(b.key)
          return (
            <li key={b.key} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-neutral-200">{p.label}</p>
                <p className="truncate text-[11px] text-neutral-500">{p.sub}{b.reason ? ` · ${b.reason}` : ''}</p>
              </div>
              <Button
                variant="ghost"
                onClick={() => unban(b.key)}
                disabled={busy === b.key}
                className="h-7 flex-shrink-0 px-2 text-xs text-neutral-400 hover:text-white"
              >
                {busy === b.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Un-ban'}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function shortNpub(hex: string): string {
  try {
    const npub = nip19.npubEncode(hex)
    return npub.slice(0, 12) + '…' + npub.slice(-6)
  } catch {
    return hex.slice(0, 10) + '…'
  }
}

function BannedPubkeys({ relay }: { relay: string }) {
  const [list, setList] = useState<BannedPubkey[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setList(await listBannedPubkeys(relay))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load banned pubkeys')
      setList(null)
    } finally {
      setLoading(false)
    }
  }, [relay])

  useEffect(() => { load() }, [load])

  const ban = async () => {
    const hex = toHex(input)
    if (!hex) { toast.error('Enter a valid npub or hex pubkey'); return }
    setBusy(true)
    try {
      await banPubkey(relay, hex, reason.trim())
      toast.success('Pubkey banned')
      setInput(''); setReason('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ban failed')
    } finally {
      setBusy(false)
    }
  }

  const allow = async (pubkey: string) => {
    try {
      await allowPubkey(relay, pubkey)
      toast.success('Pubkey unbanned')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unban failed')
    }
  }

  return (
    <section className="rounded-xl border border-[#262626] bg-[#171717] p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ban className="h-4 w-4 text-red-400" />
          <h3 className="text-sm font-semibold text-neutral-200">Banned pubkeys</h3>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={load} className="text-neutral-500 hover:text-neutral-300">
              <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        A ban blocks the pubkey from posting mod events <em>and</em> uploading blobs.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="npub… or hex pubkey"
          className="min-w-[220px] flex-1 rounded-md border border-[#262626] bg-[#1c1c1c] px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="reason (optional)"
          className="w-40 rounded-md border border-[#262626] bg-[#1c1c1c] px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
        <Button onClick={ban} disabled={busy || !input.trim()} className="bg-red-600 text-white hover:bg-red-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Ban
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
        </div>
      )}
      {loading && !list && <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />}

      {list && list.length > 0 && (
        <ul className="divide-y divide-[#1f1f1f]">
          {list.map((b) => (
            <li key={b.pubkey} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-neutral-300" title={b.pubkey}>{toNpub(b.pubkey)}</p>
                {b.reason && <p className="truncate text-[11px] text-neutral-500">{b.reason}</p>}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => allow(b.pubkey)}
                    className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-[#2a2a2a] hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Unban</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      {list && list.length === 0 && <p className="text-xs text-neutral-600">No banned pubkeys.</p>}
    </section>
  )
}
