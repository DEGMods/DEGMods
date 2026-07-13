import { generateSecretKey, getPublicKey, finalizeEvent, type UnsignedEvent } from 'nostr-tools'
import { encrypt as nip04Encrypt } from 'nostr-tools/nip04'
import { minePow } from 'nostr-tools/nip13'
import { ADMIN_PUBKEY } from '@/lib/constants'
import { publishEvent } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'

/** Hard-coded difficulty for the contact form. Deliberately NOT tied to the
 *  client's PoW slider — every submission mines the same amount of spam-deterrent
 *  work regardless of the user's settings. */
export const CONTACT_POW_DIFFICULTY = 15

export const CONTACT_SUBJECTS = ['general', 'advertisement', 'business inquiry', 'support'] as const
export type ContactSubject = (typeof CONTACT_SUBJECTS)[number]

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Send a contact message to the admin as an anonymous NIP-04 DM from a fresh
 * ephemeral key (no login needed). A NIP-13 proof of work is mined into the event
 * to deter spam. The sender's email is embedded in the encrypted body so the admin
 * can reply off-Nostr.
 */
export async function sendContactMessage(params: {
  email: string
  subject: ContactSubject
  body: string
}): Promise<void> {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)

  const plaintext =
    `DEG Mods contact form\n` +
    `Subject: ${cap(params.subject)}\n` +
    `Reply-to email: ${params.email}\n\n` +
    params.body

  const content = nip04Encrypt(sk, ADMIN_PUBKEY, plaintext)

  const unsigned: UnsignedEvent = {
    kind: 4,
    pubkey: pk,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', ADMIN_PUBKEY]],
    content,
  }

  // Let the caller paint its "Sending…" state before the synchronous mine blocks.
  await new Promise((r) => setTimeout(r, 10))

  // minePow adds the nonce tag and fixes the id for the given pubkey/tags;
  // finalizeEvent then recomputes the same id and signs, so the PoW is preserved.
  const mined = minePow(unsigned, CONTACT_POW_DIFFICULTY)
  const signed = finalizeEvent(mined, sk)

  const relays = useSettingsStore.getState().getAllEnabledRelayUrls('write')
  await publishEvent(signed, relays)
}
