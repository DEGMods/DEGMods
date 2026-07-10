import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Zap, Loader2, Copy, Check, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import type { Event as NostrEvent } from 'nostr-tools'
import { cn } from '@/lib/utils'
import { useAuthStore, signEvent } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore } from '@/stores/userStore'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import {
  fetchZapReceipts,
  totalZapSats,
  type NostrTarget,
} from '@/lib/nostr/social'
import {
  fetchLnurlPay,
  buildZapRequest,
  requestZapInvoice,
  payWithWebln,
} from '@/lib/nostr/zaps'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

interface ZapButtonProps {
  /** The event being zapped. Omit (with `recipientPubkey`) to zap a profile instead. */
  target?: NostrTarget
  /** Recipient pubkey, required when there is no `target` (profile zap). */
  recipientPubkey?: string
  /** Recipient lightning address (LUD-16). If omitted, resolved from the recipient profile. */
  recipientLud16?: string
  /** Render only the bolt icon (no sats total). */
  iconOnly?: boolean
  className?: string
}

const PRESETS = [21, 100, 500, 1000, 5000]

export function ZapButton({ target, recipientPubkey, recipientLud16, iconOnly, className }: ZapButtonProps) {
  const { pubkey } = useAuthStore()
  const recipient = target?.pubkey ?? recipientPubkey

  const [total, setTotal] = useState(0)
  const [open, setOpen] = useState(false)
  const [lud16, setLud16] = useState<string | undefined>(recipientLud16)

  const [amount, setAmount] = useState(100)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [invoice, setInvoice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!recipient || iconOnly) return
    let cancelled = false
    async function load() {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const receipts = target
        ? await fetchZapReceipts(relays, target)
        : await fetchEvents(relays, { kinds: [9735], '#p': [recipient!] }, 5000)
      if (!cancelled) setTotal(totalZapSats(receipts))
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, recipient, iconOnly])

  // Resolve recipient lightning address lazily.
  useEffect(() => {
    if (recipientLud16) { setLud16(recipientLud16); return }
    if (!recipient) return
    let cancelled = false
    async function load() {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const profile = await useUserStore.getState().fetchProfile(recipient!, relays)
      if (!cancelled) setLud16(profile?.lud16 as string | undefined)
    }
    load()
    return () => { cancelled = true }
  }, [recipientLud16, recipient])

  const openDialog = () => {
    if (!pubkey) {
      toast.error('Log in to zap')
      return
    }
    setInvoice(null)
    setComment('')
    setOpen(true)
  }

  const handleZap = async () => {
    if (sending) return
    if (!lud16) {
      toast.error('This user has no lightning address')
      return
    }
    if (amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    setSending(true)
    setInvoice(null)
    try {
      const lnurl = await fetchLnurlPay(lud16)
      if (!lnurl) throw new Error('Could not reach the lightning address')

      const amountMsat = amount * 1000
      if (amountMsat < lnurl.minSendable || amountMsat > lnurl.maxSendable) {
        throw new Error(
          `Amount must be between ${Math.ceil(lnurl.minSendable / 1000)} and ${Math.floor(lnurl.maxSendable / 1000)} sats`,
        )
      }

      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const zapRequest = buildZapRequest({
        recipientPubkey: recipient!,
        amountMsat,
        relays,
        comment: comment.trim() || undefined,
        target,
      })
      const signed = (await signEvent(zapRequest as unknown as Record<string, unknown>)) as unknown as NostrEvent

      const pr = await requestZapInvoice(lnurl.callback, amountMsat, signed)
      if (!pr) throw new Error('Failed to get a lightning invoice')

      // Try a browser wallet first; otherwise present the invoice as a QR code.
      const paid = await payWithWebln(pr)
      if (paid) {
        toast.success(`Zapped ${amount} sats ⚡`)
        setTotal(t => t + amount)
        setOpen(false)
      } else {
        setInvoice(pr)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Zap failed')
    } finally {
      setSending(false)
    }
  }

  const copyInvoice = () => {
    if (!invoice) return
    navigator.clipboard.writeText(invoice)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!recipient) return null

  return (
    <>
      <button
        onClick={openDialog}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:border-yellow-500/40 hover:bg-yellow-500/10 hover:text-yellow-400',
          className,
        )}
        aria-label="Zap"
      >
        <Zap className="h-4 w-4" />
        {!iconOnly && (
          <span className="tabular-nums">{total > 0 ? total.toLocaleString() : 'Zap'}</span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-neutral-100">
              <Zap className="h-5 w-5 text-yellow-400" />
              Send a Zap
            </DialogTitle>
            <DialogDescription className="text-neutral-400">
              {lud16
                ? <>Zap sats to <span className="text-neutral-300">{lud16}</span> over the Lightning Network.</>
                : 'This user has not set a lightning address.'}
            </DialogDescription>
          </DialogHeader>

          {invoice ? (
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={invoice.toUpperCase()} size={220} />
              </div>
              <p className="text-xs text-neutral-500 text-center">
                Scan with a Lightning wallet, or copy the invoice.
              </p>
              <div className="flex w-full gap-2">
                <Button variant="outline" className="flex-1 border-[#262626]" onClick={copyInvoice}>
                  {copied ? <Check className="h-4 w-4 mr-2 text-green-400" /> : <Copy className="h-4 w-4 mr-2" />}
                  {copied ? 'Copied' : 'Copy invoice'}
                </Button>
                <a href={`lightning:${invoice}`} className="flex-1">
                  <Button className="w-full bg-yellow-500 hover:bg-yellow-600 text-black">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open wallet
                  </Button>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-1">
              <div className="flex flex-wrap gap-2">
                {PRESETS.map(p => (
                  <button
                    key={p}
                    onClick={() => setAmount(p)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                      amount === p
                        ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400'
                        : 'border-[#262626] text-neutral-400 hover:border-[#404040]',
                    )}
                  >
                    {p.toLocaleString()}
                  </button>
                ))}
              </div>

              <div>
                <label className="text-xs text-neutral-500">Amount (sats)</label>
                <Input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={e => setAmount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="mt-1 bg-[#212121] border-[#262626] text-white"
                />
              </div>

              <div>
                <label className="text-xs text-neutral-500">Comment (optional)</label>
                <Textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Add a message…"
                  rows={2}
                  className="mt-1 bg-[#212121] border-[#262626] text-white resize-none"
                />
              </div>

              <Button
                onClick={handleZap}
                disabled={sending || !lud16}
                className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
              >
                {sending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Preparing…</>
                ) : (
                  <><Zap className="h-4 w-4 mr-2" /> Zap {amount.toLocaleString()} sats</>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
