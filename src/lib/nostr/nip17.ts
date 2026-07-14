import { generateSecretKey, getPublicKey, finalizeEvent, getEventHash, type Event as NostrEvent, type UnsignedEvent } from 'nostr-tools'
import { getConversationKey, encrypt as nip44Encrypt } from 'nostr-tools/nip44'
import { useAuthStore, signEvent } from '@/stores/authStore'
import { fetchLatestEvent, publishToRelays } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'

export const GIFT_WRAP_KIND = 1059
export const SEAL_KIND = 13
export const DM_RUMOR_KIND = 14
const DM_RELAY_LIST_KIND = 10050

/** Whether the logged-in signer can do NIP-44 (needed for NIP-17 gift wraps). */
export function signerSupportsNip17(): boolean {
  return !!useAuthStore.getState().signer?.nip44
}

/** A timestamp jittered up to 2 days into the past (NIP-59 metadata protection). */
function jitteredTs(): number {
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 2 * 24 * 60 * 60)
}

// ── First layer: unwrap the gift wrap → the seal, whose pubkey IS the sender ──

export interface FirstLayer {
  /** The real sender (seal.pubkey). */
  sender: string
  /** The still-encrypted rumor (decrypt this for the message text = second layer). */
  sealContent: string
}

export async function unwrapFirstLayer(wrap: NostrEvent): Promise<FirstLayer> {
  const signer = useAuthStore.getState().signer
  if (!signer?.nip44) throw new Error('Your login method does not support NIP-17 messages')
  const sealJson = await signer.nip44.decrypt(wrap.pubkey, wrap.content)
  const seal = JSON.parse(sealJson)
  if (seal?.kind !== SEAL_KIND || typeof seal.pubkey !== 'string' || typeof seal.content !== 'string') {
    throw new Error('Invalid seal')
  }
  return { sender: seal.pubkey, sealContent: seal.content }
}

// ── Second layer: unseal → the rumor (message text + real timestamp + recipient) ──

export interface Rumor {
  id: string
  content: string
  created_at: number
  /** The rumor's p-tag: who the message was addressed to (needed to place my own sent copies). */
  recipient: string
}

export async function unseal(sealPubkey: string, sealContent: string): Promise<Rumor> {
  const signer = useAuthStore.getState().signer
  if (!signer?.nip44) throw new Error('Your login method does not support NIP-17 messages')
  const rumorJson = await signer.nip44.decrypt(sealPubkey, sealContent)
  const rumor = JSON.parse(rumorJson)
  if (rumor?.kind !== DM_RUMOR_KIND) throw new Error('Invalid rumor')
  // The rumor's author must match the seal's author — otherwise the sender is forged.
  if (rumor.pubkey !== sealPubkey) throw new Error('Sender mismatch')
  const recipient = (rumor.tags as string[][] | undefined)?.find((t) => t[0] === 'p')?.[1] || ''
  return { id: getEventHash(rumor), content: rumor.content, created_at: rumor.created_at, recipient }
}

// ── Send: rumor → seal (signer nip44 + our signature) → gift wrap (throwaway key) ──

async function makeSeal(rumorJson: string, toPubkey: string, me: string): Promise<NostrEvent> {
  const signer = useAuthStore.getState().signer!
  const content = await signer.nip44!.encrypt(toPubkey, rumorJson)
  const signed = await signEvent({ kind: SEAL_KIND, pubkey: me, created_at: jitteredTs(), tags: [], content })
  return signed as unknown as NostrEvent
}

function makeWrap(sealJson: string, toPubkey: string): NostrEvent {
  const tk = generateSecretKey()
  const content = nip44Encrypt(sealJson, getConversationKey(tk, toPubkey))
  const draft: UnsignedEvent = {
    kind: GIFT_WRAP_KIND,
    pubkey: getPublicKey(tk),
    created_at: jitteredTs(),
    tags: [['p', toPubkey]],
    content,
  }
  return finalizeEvent(draft, tk)
}

async function recipientDmRelays(pubkey: string): Promise<string[]> {
  try {
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    const ev = await fetchLatestEvent(relays, { kinds: [DM_RELAY_LIST_KIND], authors: [pubkey] })
    return ev ? ev.tags.filter((t) => t[0] === 'relay' && t[1]).map((t) => t[1]) : []
  } catch { return [] }
}

/**
 * Encrypt + publish a NIP-17 DM to `recipient`, plus a self-copy so it syncs to
 * my own devices. Returns info about the self-copy so the sender can show it
 * immediately (and dedupe the echo). Publishes the recipient copy to their
 * kind-10050 DM relays (falling back to my write relays).
 */
export async function sendGiftWrap(recipient: string, text: string): Promise<{ selfWrapId: string; createdAt: number }> {
  const me = useAuthStore.getState().pubkey
  const signer = useAuthStore.getState().signer
  if (!me || !signer?.nip44) throw new Error('Your login method does not support NIP-17 messages')

  const createdAt = Math.floor(Date.now() / 1000)
  const rumor: UnsignedEvent = { kind: DM_RUMOR_KIND, pubkey: me, created_at: createdAt, tags: [['p', recipient]], content: text }
  const rumorJson = JSON.stringify({ ...rumor, id: getEventHash(rumor) })

  const wrapForRecipient = makeWrap(JSON.stringify(await makeSeal(rumorJson, recipient, me)), recipient)
  const wrapForSelf = makeWrap(JSON.stringify(await makeSeal(rumorJson, me, me)), me)

  const myWrite = useSettingsStore.getState().getAllEnabledRelayUrls('write')
  const theirRelays = await recipientDmRelays(recipient)
  const recipientTargets = theirRelays.length ? theirRelays : myWrite

  await Promise.allSettled([
    publishToRelays(recipientTargets, wrapForRecipient),
    publishToRelays(myWrite, wrapForSelf),
  ])

  return { selfWrapId: wrapForSelf.id, createdAt }
}
