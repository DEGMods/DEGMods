/**
 * NIP-57 zap flow: LNURL-pay (LUD-16 lightning address) → zap request
 * (kind 9734) → invoice → WebLN payment (with QR fallback handled by the UI).
 */

import type { UnsignedEvent, Event as NostrEvent } from 'nostr-tools'
import type { NostrTarget } from './social'

const now = () => Math.floor(Date.now() / 1000)

export interface LnurlPayData {
  callback: string
  minSendable: number // millisats
  maxSendable: number // millisats
  allowsNostr: boolean
  nostrPubkey?: string
}

/** Resolve a LUD-16 lightning address (`name@domain`) to its LNURL-pay params. */
export async function fetchLnurlPay(lud16: string): Promise<LnurlPayData | null> {
  const at = lud16.indexOf('@')
  if (at <= 0) return null
  const name = lud16.slice(0, at)
  const domain = lud16.slice(at + 1)
  if (!name || !domain) return null

  try {
    const res = await fetch(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.tag !== 'payRequest' || !data.callback) return null
    return {
      callback: data.callback as string,
      minSendable: Number(data.minSendable) || 1000,
      maxSendable: Number(data.maxSendable) || 100_000_000,
      allowsNostr: !!data.allowsNostr,
      nostrPubkey: data.nostrPubkey,
    }
  } catch {
    return null
  }
}

/** Build an unsigned kind 9734 zap request for a target event. */
export function buildZapRequest(params: {
  recipientPubkey: string
  amountMsat: number
  relays: string[]
  comment?: string
  target?: NostrTarget
}): UnsignedEvent {
  const tags: string[][] = [
    ['relays', ...params.relays.slice(0, 10)],
    ['amount', params.amountMsat.toString()],
    ['p', params.recipientPubkey],
  ]
  if (params.target?.aTag) tags.push(['a', params.target.aTag])
  if (params.target?.id) tags.push(['e', params.target.id])

  return {
    kind: 9734,
    content: params.comment ?? '',
    tags,
    created_at: now(),
    pubkey: '',
  }
}

/** Request a bolt11 invoice from the LNURL callback, embedding the signed zap request. */
export async function requestZapInvoice(
  callback: string,
  amountMsat: number,
  zapRequest: NostrEvent,
): Promise<string | null> {
  try {
    const url = new URL(callback)
    url.searchParams.set('amount', amountMsat.toString())
    url.searchParams.set('nostr', JSON.stringify(zapRequest))
    const res = await fetch(url.toString())
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.pr === 'string' ? data.pr : null
  } catch {
    return null
  }
}

interface WebLNProvider {
  enable(): Promise<void>
  sendPayment(invoice: string): Promise<{ preimage: string }>
}

function getWebln(): WebLNProvider | null {
  const w = window as unknown as { webln?: WebLNProvider }
  return w.webln ?? null
}

/** Attempt to pay an invoice via a WebLN browser wallet. Returns false if unavailable/declined. */
export async function payWithWebln(invoice: string): Promise<boolean> {
  const webln = getWebln()
  if (!webln) return false
  try {
    await webln.enable()
    await webln.sendPayment(invoice)
    return true
  } catch {
    return false
  }
}

export function hasWebln(): boolean {
  return getWebln() !== null
}
