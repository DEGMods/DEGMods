/**
 * Secure Storage: Web-only stub
 *
 * All desktop-only functions (Tauri keyring) are no-ops on web.
 * Auth on web is via external signers only (NIP-07, NIP-46, PC55, UPV2).
 */

export interface StoredAccount {
  pubkey: string
  npub: string
  name: string | null
  auth_method: 'seed' | 'nsec'
  seed_id: string | null
  account_index: number | null
  created_at: number
  has_pin: boolean
  pin_hint: string | null
}

export interface StoredSeed {
  id: string
  name: string
  account_pubkeys: string[]
}

// All operations are no-ops on web (desktop-only features)
export async function listAccounts(): Promise<StoredAccount[]> { return [] }
export async function listSeeds(): Promise<StoredSeed[]> { return [] }
export async function generateAccount(): Promise<never> { throw new Error('Account generation requires the desktop app') }
export async function generateNewSeed(): Promise<never> { throw new Error('Seed generation requires the desktop app') }
export async function deriveNextAccount(): Promise<never> { throw new Error('Account derivation requires the desktop app') }
export async function importSeed(): Promise<never> { throw new Error('Seed import requires the desktop app') }
export async function importNsec(): Promise<never> { throw new Error('Nsec import requires the desktop app') }
export async function verifyPin(): Promise<boolean> { return false }
export async function loginAccount(): Promise<string> { throw new Error('Pin login requires the desktop app') }
export async function deleteAccount(): Promise<void> {}
export async function exportSeed(): Promise<string> { throw new Error('Seed export requires the desktop app') }
export async function exportNsec(): Promise<string> { throw new Error('Nsec export requires the desktop app') }
export async function renameAccount(): Promise<void> {}
export async function changePin(): Promise<void> { throw new Error('Pin management requires the desktop app') }
export async function getActiveAccount(): Promise<string | null> { return null }
export async function secureStore(): Promise<void> {}
export async function secureRetrieve(): Promise<string | null> { return null }
export async function secureDelete(): Promise<void> {}
