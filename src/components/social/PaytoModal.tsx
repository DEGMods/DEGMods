import { useState, useEffect, useRef } from 'react'
import { Wallet, Loader2, Plus, Pencil, Trash2, X, Save, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { signAndPublish } from '@/lib/nostr/publish'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAuthStore } from '@/stores/authStore'
import { KINDS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  extractPaymentTargets, buildPaytoEvent, paymentTypeLabel, suggestPaymentTypes,
  normalizePaytoType, type PaymentTarget,
} from '@/lib/nostr/payto'

const MAX_TARGETS = 25
const LIMITS = { type: 40, authority: 300 } as const

/** Copies the authority alone — the address is what a payer pastes into a wallet,
 *  not the payto:// URI wrapping it. */
function CopyAuthority({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Couldn’t copy to clipboard')
    }
  }
  return (
    <button
      onClick={copy}
      aria-label="Copy address"
      className="shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-[#262626] hover:text-white"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}

/** Type field with type-ahead. The list is a convenience, never a constraint —
 *  any type is valid, so free text is always accepted. */
function TypeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const matches = suggestPaymentTypes(value)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const choose = (type: string) => { onChange(type); setOpen(false) }

  return (
    <div ref={wrapRef} className="relative w-full sm:w-44">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % matches.length) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h - 1 + matches.length) % matches.length) }
          else if (e.key === 'Enter') { e.preventDefault(); choose(matches[highlight].type) }
          else if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Type (e.g. bitcoin)"
        maxLength={LIMITS.type}
        className="border-[#262626] bg-[#212121] text-white placeholder:text-neutral-500"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full min-w-[15rem] overflow-y-auto rounded-lg border border-[#262626] bg-[#1a1a1a] py-1 shadow-xl">
          {matches.map((m, i) => (
            <li key={m.type}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(m.type)}
                className={cn(
                  'flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm',
                  i === highlight ? 'bg-[#262626] text-white' : 'text-neutral-300',
                )}
              >
                <span className="truncate">{m.label}</span>
                {m.region && <span className="shrink-0 text-[10px] text-neutral-500">{m.region}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Someone's payment targets (NIP-A3, kind 10133).
 *
 * Read-only for other people; your own opens with an edit affordance even when
 * empty, which is the only way to add a first one.
 */
export function PaytoModal({
  open, onOpenChange, pubkey, displayName,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  pubkey: string
  displayName: string
}) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const isSelf = myPubkey === pubkey

  const [targets, setTargets] = useState<PaymentTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PaymentTarget[]>([])
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setEditing(false)
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchLatestEvent(relays, { kinds: [KINDS.PAYTO], authors: [pubkey] })
      .then((ev) => { if (!cancelled) setTargets(extractPaymentTargets(ev)) })
      .catch(() => { if (!cancelled) setTargets([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, pubkey])

  const startEdit = () => {
    setDraft(targets.length ? targets.map((t) => ({ ...t })) : [{ type: '', authority: '', extra: [] }])
    setEditing(true)
  }

  const publish = async () => {
    const cleaned = draft
      .map((t) => ({ ...t, type: normalizePaytoType(t.type), authority: t.authority.trim() }))
      .filter((t) => t.type && t.authority)
    if (draft.some((t) => (t.type.trim() && !t.authority.trim()) || (!t.type.trim() && t.authority.trim()))) {
      toast.error('Each entry needs both a type and an address')
      return
    }
    setPublishing(true)
    try {
      // Replaceable: publishing the full set is what removes anything dropped,
      // so an empty list is a legitimate "clear them all".
      const res = await signAndPublish(buildPaytoEvent(cleaned))
      if (!res.success) throw new Error(res.error || 'Failed to publish')
      setTargets(cleaned)
      setEditing(false)
      toast.success(cleaned.length ? 'Payment targets saved' : 'Payment targets cleared')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish')
    } finally {
      setPublishing(false)
    }
  }

  const update = (i: number, patch: Partial<PaymentTarget>) =>
    setDraft((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto border-[#262626] bg-[#1c1c1c] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-neutral-100">
            <Wallet className="h-5 w-5 text-purple-400" />
            Payment targets
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            {isSelf ? 'Where people can pay you.' : `Where ${displayName} can be paid.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : editing ? (
          <div className="space-y-3 py-1">
            {draft.map((t, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-[#262626] p-2 sm:flex-row sm:items-start">
                <TypeField value={t.type} onChange={(v) => update(i, { type: v })} />
                <Input
                  value={t.authority}
                  onChange={(e) => update(i, { authority: e.target.value })}
                  placeholder="Address / handle"
                  maxLength={LIMITS.authority}
                  className="flex-1 border-[#262626] bg-[#212121] font-mono text-xs text-white placeholder:text-neutral-500"
                />
                <button
                  type="button"
                  onClick={() => setDraft((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Remove"
                  className="shrink-0 self-end rounded-md p-2 text-neutral-500 transition-colors hover:text-red-400 sm:self-auto"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}

            {draft.length < MAX_TARGETS && (
              <Button
                type="button" variant="outline" size="sm"
                className="gap-1.5 border-[#262626] text-xs"
                onClick={() => setDraft((prev) => [...prev, { type: '', authority: '', extra: [] }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add another
              </Button>
            )}

            <div className="flex justify-end gap-2 border-t border-[#262626] pt-3">
              <Button variant="outline" className="gap-1.5 border-[#262626]" onClick={() => setEditing(false)} disabled={publishing}>
                <X className="h-4 w-4" /> Cancel
              </Button>
              <Button onClick={publish} disabled={publishing} className="gap-1.5 bg-purple-600 text-white hover:bg-purple-700">
                {publishing ? <><Loader2 className="h-4 w-4 animate-spin" /> Publishing…</> : <><Save className="h-4 w-4" /> Publish</>}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            {targets.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-500">
                {isSelf ? 'You haven’t added any payment targets yet.' : `${displayName} hasn’t listed any payment targets.`}
              </p>
            ) : (
              <ul className="space-y-2">
                {targets.map((t, i) => (
                  <li key={`${t.type}-${i}`} className="flex items-center gap-3 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2">
                    <span className="w-24 shrink-0 truncate text-sm font-medium text-neutral-200" title={t.type}>
                      {paymentTypeLabel(t.type)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-400" title={t.authority}>
                      {t.authority}
                    </span>
                    <CopyAuthority value={t.authority} />
                  </li>
                ))}
              </ul>
            )}

            {isSelf && (
              <div className="flex justify-end border-t border-[#262626] pt-3">
                <Button variant="outline" className="gap-1.5 border-[#262626]" onClick={startEdit}>
                  <Pencil className="h-4 w-4" /> {targets.length ? 'Edit' : 'Add payment targets'}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
