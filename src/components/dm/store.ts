// Minimal shape the shared DM list/chat components read, satisfied by both the
// NIP-04 store (useDMStore) and the NIP-17 store (useDM17Store).
export interface DMViewMessage { id: string; mine: boolean; created_at: number; plaintext?: string; error?: boolean }
export interface DMViewConversation { pubkey: string; lastTs: number; lastIncomingTs: number; messages: DMViewMessage[] }

export interface DMViewState {
  conversations: Record<string, DMViewConversation>
  seenLatest: number
  seenOldest: number
  active: string | null
  openConversation: (pk: string) => void | Promise<void>
  closeConversation: () => void
  decryptMessage: (pk: string, id: string) => Promise<void>
  decryptConversation: (pk: string) => Promise<void>
  /** Stop an in-progress batch decrypt (decryptConversation/decryptAll). */
  cancelBatchDecrypt: () => void
  send: (recipient: string, text: string) => Promise<void>
}

/** A zustand hook narrowed to the shared view shape. */
export type DMStoreHook = <U>(selector: (s: DMViewState) => U) => U
