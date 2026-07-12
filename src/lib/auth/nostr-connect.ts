/**
 * NIP-46 Nostr Connect Signer: Login via nostrconnect:// URI
 * Ported from Jumble's nostrConnection.signer.ts
 *
 * Flow:
 * 1. Client generates clientSecretKey and builds nostrconnect:// URI
 * 2. URI is displayed (QR code / copy) for user to paste in signer app
 * 3. Call login(): it blocks until the remote signer connects via relay
 * 4. Once connected, getPublicKey/signEvent/etc work normally
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { BunkerSigner as NBunkerSigner, createNostrConnectURI, toBunkerURL } from 'nostr-tools/nip46'
import { bytesToHex } from '@noble/hashes/utils'

// The FIRST relay must be a dedicated NIP-46 handshake relay that reliably fans
// out the ephemeral kind-24133 messages between the signer (e.g. Amber) and this
// browser. `bucket.coracle.social` is purpose-built for this and is what the
// working reference clients (Jumble / Den Chat) use; general feed relays don't
// always deliver the connect handshake in time, so nostrconnect silently hangs.
const DEFAULT_RELAYS = ['wss://bucket.coracle.social/', 'wss://relay.primal.net/', 'wss://relay.damus.io/']

export interface NostrConnectLoginDetails {
  privKey: Uint8Array
  connectionString: string
}

/** Reject if `promise` doesn't settle within `ms`, so a silent signer can't hang the login. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ])
}

/**
 * Generate login details (keys + connection URI) upfront.
 * This should be called once when the UI mounts.
 */
export function generateNostrConnectDetails(relays: string[] = DEFAULT_RELAYS): NostrConnectLoginDetails {
  const privKey = generateSecretKey()
  const connectionString = createNostrConnectURI({
    clientPubkey: getPublicKey(privKey),
    relays,
    secret: Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''),
    // Host (no spaces) — some signers mangle a name with a space in the URI query.
    name: window.location.host,
    url: window.location.origin,
  })
  return { privKey, connectionString }
}

export class NostrConnectSigner {
  signer: NBunkerSigner | null = null
  private clientSecretKey: Uint8Array
  private pubkey: string | null = null
  private bunkerString: string | null = null

  constructor(clientSecretKey: Uint8Array) {
    this.clientSecretKey = clientSecretKey
  }

  /**
   * Login using a nostrconnect:// connection string.
   * This call BLOCKS until the remote signer connects via the relay.
   * No manual "I've connected" button needed.
   *
   * @param abortSignal Optional AbortSignal to cancel the connection attempt
   */
  async login(connectionString: string, abortSignal?: AbortSignal): Promise<{ bunkerString: string | null; pubkey: string }> {
    this.signer = await NBunkerSigner.fromURI(this.clientSecretKey, connectionString, {
      onauth: (url) => {
        window.open(url, '_blank')
      },
    }, abortSignal || 60_000)

    this.bunkerString = toBunkerURL(this.signer.bp)
    // The handshake is done here, but a signer that never answers get_public_key
    // would otherwise hang the login forever — cap it so we surface an error.
    this.pubkey = await withTimeout(this.signer.getPublicKey(), 15_000, 'Signer connected but did not return your public key in time')

    return { bunkerString: this.bunkerString, pubkey: this.pubkey }
  }

  async getPublicKey(): Promise<string> {
    if (!this.signer) throw new Error('Not logged in')
    if (!this.pubkey) {
      this.pubkey = await this.signer.getPublicKey()
    }
    return this.pubkey
  }

  async signEvent(draftEvent: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.signer) throw new Error('Not logged in')
    return this.signer.signEvent(draftEvent as any) as any
  }

  async nip04Encrypt(pubkey: string, plainText: string): Promise<string> {
    if (!this.signer) throw new Error('Not logged in')
    return this.signer.nip04Encrypt(pubkey, plainText)
  }

  async nip04Decrypt(pubkey: string, cipherText: string): Promise<string> {
    if (!this.signer) throw new Error('Not logged in')
    return this.signer.nip04Decrypt(pubkey, cipherText)
  }

  /**
   * NIP-04 encrypt/decrypt object: for NIP-04 (kind 4) DM support.
   * The presence of this getter is how the app detects NIP-04 capability.
   */
  get nip04() {
    return {
      encrypt: (pubkey: string, plaintext: string) => this.nip04Encrypt(pubkey, plaintext),
      decrypt: (pubkey: string, ciphertext: string) => this.nip04Decrypt(pubkey, ciphertext),
    }
  }

  async nip44Encrypt(pubkey: string, plainText: string): Promise<string> {
    if (!this.signer) throw new Error('Not logged in')
    return this.signer.nip44Encrypt(pubkey, plainText)
  }

  async nip44Decrypt(pubkey: string, cipherText: string): Promise<string> {
    if (!this.signer) throw new Error('Not logged in')
    return this.signer.nip44Decrypt(pubkey, cipherText)
  }

  /**
   * NIP-44 encrypt/decrypt object: exposes signer's nip44 capabilities
   */
  get nip44() {
    return {
      encrypt: (pubkey: string, plaintext: string) => this.nip44Encrypt(pubkey, plaintext),
      decrypt: (pubkey: string, ciphertext: string) => this.nip44Decrypt(pubkey, ciphertext),
    }
  }

  getClientSecretKey(): string {
    return bytesToHex(this.clientSecretKey)
  }

  getBunkerString(): string | null {
    return this.bunkerString
  }

  close(): void {
    this.signer = null
    this.pubkey = null
    this.bunkerString = null
  }
}
