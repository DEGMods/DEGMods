import { create } from 'zustand'
import type { Event as NostrEvent } from 'nostr-tools'
import { fetchEvents, subscribe } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { DM_KIND, counterpartyOf, decryptContent, sendDM } from '@/lib/nostr/dm'

export interface DMMessage {
  id: string
  from: string
  created_at: number
  ciphertext: string
  mine: boolean
  /** Set once decrypted (in-memory only — never persisted). */
  plaintext?: string
  /** Set if a decrypt attempt failed. */
  error?: boolean
}

export interface DMConversation {
  pubkey: string // the counterparty
  lastTs: number // newest message either direction (for list ordering)
  lastIncomingTs: number // newest message FROM them (for unread)
  messages: DMMessage[] // ascending by created_at
  historyLoaded: boolean
}

const READ_KEY = 'degmods:dm-read'
const MAX_PER_CONV = 1000

function loadRead(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(READ_KEY) || '{}') } catch { return {} }
}
function persistRead(read: Record<string, number>) {
  try { localStorage.setItem(READ_KEY, JSON.stringify(read)) } catch { /* ignore */ }
}

interface DMState {
  me: string | null
  conversations: Record<string, DMConversation>
  read: Record<string, number>
  active: string | null
  historyLoaded: boolean
  loadingHistory: boolean

  /** Fold a raw kind-4 event into its conversation (no decryption). */
  ingest: (ev: NostrEvent) => void
  /** Start the app-wide open subscription (both directions) + backfill. Returns a stop fn. */
  start: (me: string) => () => void
  /** Backfill recent DM history so the list is complete, not just this session. */
  loadHistory: () => Promise<void>
  /** Open a conversation: fetch its full history and mark it read. */
  openConversation: (pubkey: string) => Promise<void>
  closeConversation: () => void
  markRead: (pubkey: string) => void

  decryptMessage: (pubkey: string, id: string) => Promise<void>
  decryptConversation: (pubkey: string) => Promise<void>
  decryptAll: () => Promise<void>

  send: (recipient: string, text: string) => Promise<void>
  reset: () => void
}

function upsertMessage(conv: DMConversation | undefined, pubkey: string, msg: DMMessage): DMConversation {
  const base: DMConversation = conv ?? { pubkey, lastTs: 0, lastIncomingTs: 0, messages: [], historyLoaded: false }
  if (base.messages.some((m) => m.id === msg.id)) return base // dedup by event id
  let messages = [...base.messages, msg].sort((a, b) => a.created_at - b.created_at)
  if (messages.length > MAX_PER_CONV) messages = messages.slice(messages.length - MAX_PER_CONV)
  return {
    ...base,
    messages,
    lastTs: Math.max(base.lastTs, msg.created_at),
    lastIncomingTs: msg.mine ? base.lastIncomingTs : Math.max(base.lastIncomingTs, msg.created_at),
  }
}

export const useDMStore = create<DMState>((set, get) => ({
  me: null,
  conversations: {},
  read: loadRead(),
  active: null,
  historyLoaded: false,
  loadingHistory: false,

  ingest: (ev) => {
    const me = get().me
    if (!me || ev.kind !== DM_KIND) return
    const other = counterpartyOf(ev, me)
    if (!other) return
    const mine = ev.pubkey === me
    const msg: DMMessage = { id: ev.id, from: ev.pubkey, created_at: ev.created_at, ciphertext: ev.content, mine }
    set((s) => ({ conversations: { ...s.conversations, [other]: upsertMessage(s.conversations[other], other, msg) } }))
  },

  start: (me) => {
    set({ me })
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    const onEvent = (ev: NostrEvent) => get().ingest(ev)
    // Two subscriptions: DMs TO me, and DMs FROM me (sent from any client).
    const subIn = subscribe(relays, { kinds: [DM_KIND], '#p': [me] }, onEvent)
    const subOut = subscribe(relays, { kinds: [DM_KIND], authors: [me] }, onEvent)
    void get().loadHistory()
    return () => { subIn.close(); subOut.close() }
  },

  loadHistory: async () => {
    const me = get().me
    if (!me || get().loadingHistory) return
    set({ loadingHistory: true })
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const [incoming, outgoing] = await Promise.all([
        fetchEvents(relays, { kinds: [DM_KIND], '#p': [me], limit: 300 }, 8000),
        fetchEvents(relays, { kinds: [DM_KIND], authors: [me], limit: 300 }, 8000),
      ])
      for (const ev of [...incoming, ...outgoing]) get().ingest(ev)
    } catch { /* best-effort */ } finally {
      set({ historyLoaded: true, loadingHistory: false })
    }
  },

  openConversation: async (pubkey) => {
    set({ active: pubkey })
    get().markRead(pubkey)
    const me = get().me
    const conv = get().conversations[pubkey]
    if (!me || conv?.historyLoaded) return
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const [fromThem, toThem] = await Promise.all([
        fetchEvents(relays, { kinds: [DM_KIND], authors: [pubkey], '#p': [me], limit: 500 }, 8000),
        fetchEvents(relays, { kinds: [DM_KIND], authors: [me], '#p': [pubkey], limit: 500 }, 8000),
      ])
      for (const ev of [...fromThem, ...toThem]) get().ingest(ev)
    } catch { /* best-effort */ } finally {
      set((s) => {
        const c = s.conversations[pubkey]
        if (!c) return {}
        return { conversations: { ...s.conversations, [pubkey]: { ...c, historyLoaded: true } } }
      })
      get().markRead(pubkey)
    }
  },

  closeConversation: () => set({ active: null }),

  markRead: (pubkey) => set((s) => {
    const read = { ...s.read, [pubkey]: Math.floor(Date.now() / 1000) }
    persistRead(read)
    return { read }
  }),

  decryptMessage: async (pubkey, id) => {
    const me = get().me
    const conv = get().conversations[pubkey]
    const msg = conv?.messages.find((m) => m.id === id)
    if (!me || !conv || !msg || msg.plaintext !== undefined) return
    const patch = (fields: Partial<DMMessage>) => set((s) => {
      const c = s.conversations[pubkey]
      if (!c) return {}
      return { conversations: { ...s.conversations, [pubkey]: { ...c, messages: c.messages.map((m) => m.id === id ? { ...m, ...fields } : m) } } }
    })
    try {
      const plaintext = await decryptContent(pubkey, msg.ciphertext)
      patch({ plaintext, error: false })
    } catch {
      patch({ error: true })
    }
  },

  decryptConversation: async (pubkey) => {
    const conv = get().conversations[pubkey]
    if (!conv) return
    for (const m of conv.messages) {
      if (m.plaintext === undefined) await get().decryptMessage(pubkey, m.id)
    }
  },

  decryptAll: async () => {
    for (const pubkey of Object.keys(get().conversations)) {
      await get().decryptConversation(pubkey)
    }
  },

  send: async (recipient, text) => {
    const signed = await sendDM(recipient, text)
    // We already know our own plaintext — store it decrypted without a round-trip.
    get().ingest(signed)
    set((s) => {
      const c = s.conversations[recipient]
      if (!c) return {}
      return { conversations: { ...s.conversations, [recipient]: { ...c, messages: c.messages.map((m) => m.id === signed.id ? { ...m, plaintext: text } : m) } } }
    })
  },

  reset: () => set({ me: null, conversations: {}, active: null, historyLoaded: false, loadingHistory: false }),
}))

/** True when any conversation has an incoming message newer than its read marker. */
export function selectHasUnreadDM(s: DMState): boolean {
  return Object.values(s.conversations).some((c) => c.lastIncomingTs > (s.read[c.pubkey] ?? 0))
}
