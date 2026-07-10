/**
 * Auth Store: manages authentication state
 */

import { create } from 'zustand'
import { StorageKey, SECURE_KEYS } from '@/lib/constants'
import { secureRemove } from '@/lib/storage/secureStore'
import upv2Service from '@/services/upv2.service'

export type AuthMethod = 'nip07' | 'nip46' | 'pc55' | 'upv2' | null

export interface ISigner {
  getPublicKey(): Promise<string>
  signEvent(draftEvent: Record<string, unknown>): Promise<Record<string, unknown>>
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
  close?(): void
}

export interface AuthState {
  isAuthenticated: boolean
  pubkey: string | null
  authMethod: AuthMethod
  signer: ISigner | null
  localSignerName: string | null

  login: (pubkey: string, method: AuthMethod) => void
  logout: () => void
  setSigner: (signer: ISigner | null) => void
  setLocalSigner: (name: string | null) => void
  restoreSession: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  pubkey: null,
  authMethod: null,
  signer: null,
  localSignerName: null,

  login: (pubkey, method) => {
    localStorage.setItem(StorageKey.CURRENT_ACCOUNT, pubkey)
    localStorage.setItem(StorageKey.AUTH_METHOD, method ?? '')
    set({ isAuthenticated: true, pubkey, authMethod: method })
  },

  logout: () => {
    const { signer } = get()
    if (signer?.close) signer.close()
    upv2Service.logout()
    secureRemove(SECURE_KEYS.UPV2_SESSION).catch(() => {})
    localStorage.removeItem(StorageKey.CURRENT_ACCOUNT)
    localStorage.removeItem(StorageKey.AUTH_METHOD)
    localStorage.removeItem(StorageKey.BUNKER_KEY)
    localStorage.removeItem(StorageKey.BUNKER_STRING)
    localStorage.removeItem(StorageKey.PC55_CLIENT_KEY)
    set({
      isAuthenticated: false,
      pubkey: null,
      authMethod: null,
      signer: null,
      localSignerName: null,
    })
  },

  setSigner: (signer) => set({ signer }),
  setLocalSigner: (name) => set({ localSignerName: name }),

  restoreSession: () => {
    const pubkey = localStorage.getItem(StorageKey.CURRENT_ACCOUNT)
    const method = localStorage.getItem(StorageKey.AUTH_METHOD) as AuthMethod
    if (pubkey && method) {
      set({ pubkey, authMethod: method })
      // Signer must be re-established by the login flow
    }
  },
}))

function accountMismatchError(expected: string, active: string): Error {
  return new Error(
    `Your signer is on a different account (${active.slice(0, 8)}…) than the one you're ` +
    `logged in with (${expected.slice(0, 8)}…). Switch your signer back to that account, ` +
    `or log out and log in with the other one.`,
  )
}

// Helper: sign an event using the current signer.
//
// Remote signers (browser extensions, NIP-46 bunkers, PC55) can switch the
// active account out from under us. We pin signing to the account you logged in
// with: before signing we check the signer's active pubkey (a silent read, no
// approval prompt) and refuse early if it differs — so the wrong account is
// never even asked to sign. The post-sign check is a backstop for signers that
// can't report their key up front.
export async function signEvent(
  event: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { signer, pubkey } = useAuthStore.getState()
  if (!signer) throw new Error('No signer available, please log in')

  if (pubkey) {
    let active: string | undefined
    try {
      active = await signer.getPublicKey()
    } catch {
      // Signer offline / can't report — fall through; the post-sign check covers it.
    }
    if (active && active !== pubkey) throw accountMismatchError(pubkey, active)
  }

  const signed = await signer.signEvent(event)
  const signedPubkey = (signed as { pubkey?: string }).pubkey
  if (pubkey && signedPubkey && signedPubkey !== pubkey) {
    throw accountMismatchError(pubkey, signedPubkey)
  }
  return signed
}
