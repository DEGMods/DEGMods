import type { Event as NostrEvent } from 'nostr-tools'
import { useAuthStore, signEvent } from '@/stores/authStore'
import { publishEvent } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'

/** NIP-04 encrypted direct message. */
export const DM_KIND = 4

/**
 * The other party of a kind-4 DM relative to `me`: for a message I sent, the
 * recipient (p-tag); for one I received, the author (only if it's addressed to
 * me). Returns null if the event isn't a DM involving me.
 */
export function counterpartyOf(ev: NostrEvent, me: string): string | null {
  if (ev.pubkey === me) {
    const p = ev.tags.find((t) => t[0] === 'p')?.[1]
    return p || null
  }
  const toMe = ev.tags.some((t) => t[0] === 'p' && t[1] === me)
  return toMe ? ev.pubkey : null
}

/** Whether the logged-in signer can encrypt/decrypt NIP-04 (extension/bunker/local do; UPV2 may not). */
export function signerSupportsDM(): boolean {
  return !!useAuthStore.getState().signer?.nip04
}

/**
 * Decrypt NIP-04 ciphertext exchanged with `counterparty`. The NIP-04 shared
 * secret is symmetric (ECDH of my key and theirs), so the same call decrypts
 * both messages I sent to them and messages they sent to me.
 */
export async function decryptContent(counterparty: string, ciphertext: string): Promise<string> {
  const signer = useAuthStore.getState().signer
  if (!signer?.nip04) throw new Error('Your login method does not support NIP-04 messages')
  return signer.nip04.decrypt(counterparty, ciphertext)
}

/** Encrypt, sign and publish a NIP-04 DM to `recipient`. Returns the signed event. */
export async function sendDM(recipient: string, text: string): Promise<NostrEvent> {
  const signer = useAuthStore.getState().signer
  if (!signer?.nip04) throw new Error('Your login method does not support NIP-04 messages')
  const content = await signer.nip04.encrypt(recipient, text)
  const draft = {
    kind: DM_KIND,
    content,
    tags: [['p', recipient]],
    created_at: Math.floor(Date.now() / 1000),
  }
  const signed = (await signEvent(draft)) as unknown as NostrEvent
  const relays = useSettingsStore.getState().getAllEnabledRelayUrls('write')
  await publishEvent(signed, relays)
  return signed
}
