/**
 * Session restore: re-establish a persisted login on app start (new tab /
 * reload) and on cross-tab account changes.
 *
 * Reads the saved account + auth method, marks the session active immediately
 * so the UI doesn't flash "logged out", then reconnects the signer. Best-effort
 * for remote signers (extension locked, bunker offline, …): the user stays
 * logged in and signing will prompt or fail until it recovers.
 *
 * UPV2 sessions are restored from the encrypted IndexedDB store (not plaintext
 * localStorage) and only if still unexpired.
 */

import { useAuthStore, type AuthMethod, type ISigner } from '@/stores/authStore'
import { StorageKey, SECURE_KEYS } from '@/lib/constants'
import { Nip07Signer, BunkerSigner, PC55Signer } from '@/lib/auth'
import { secureGet, secureRemove } from '@/lib/storage/secureStore'
import upv2Service, { type UPV2Session } from '@/services/upv2.service'

let inflight: Promise<void> | null = null

/** Restore the persisted session. Concurrent calls share one run; later calls re-run. */
export function restoreSession(): Promise<void> {
  if (inflight) return inflight
  inflight = doRestore().finally(() => { inflight = null })
  return inflight
}

async function doRestore(): Promise<void> {
  const pubkey = localStorage.getItem(StorageKey.CURRENT_ACCOUNT)
  const method = localStorage.getItem(StorageKey.AUTH_METHOD) as AuthMethod
  if (!pubkey || !method) return

  const auth = useAuthStore.getState()
  if (auth.signer && auth.pubkey === pubkey) return

  // Optimistically reflect the session immediately.
  auth.login(pubkey, method)
  const setSigner = (s: ISigner) => useAuthStore.getState().setSigner(s)

  try {
    if (method === 'nip07') {
      // Set the signer regardless of the extension's currently-active account;
      // signEvent() enforces it matches the logged-in pubkey at sign time.
      const signer = new Nip07Signer()
      await signer.init()
      setSigner(signer as unknown as ISigner)
    } else if (method === 'nip46') {
      const clientKey = localStorage.getItem(StorageKey.BUNKER_KEY)
      const bunkerString = localStorage.getItem(StorageKey.BUNKER_STRING)
      if (clientKey && bunkerString) {
        const signer = new BunkerSigner(clientKey)
        await signer.login(bunkerString, false)
        setSigner(signer as unknown as ISigner)
      }
    } else if (method === 'pc55') {
      const signer = new PC55Signer()
      await signer.init()
      setSigner(signer as unknown as ISigner)
    } else if (method === 'upv2') {
      const session = await secureGet<UPV2Session>(SECURE_KEYS.UPV2_SESSION)
      if (session && session.signerPubkey === pubkey && session.expiresAt > Date.now()) {
        upv2Service.restoreSession(session)
        setSigner(upv2Service as unknown as ISigner)
      } else {
        // Missing or expired: can't restore; clear it and drop the session.
        await secureRemove(SECURE_KEYS.UPV2_SESSION)
        useAuthStore.getState().logout()
      }
    }
  } catch {
    // Leave the session marker in place; signing will recover or re-prompt.
  }
}
