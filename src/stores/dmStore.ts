import { create } from 'zustand'
import type { Event as NostrEvent } from 'nostr-tools'
import { fetchEvents, fetchLatestEvent, subscribe, publishEvent } from '@/lib/nostr/relay-pool'
import { signEvent } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useBlockStore } from '@/stores/blockStore'
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
  lastTs: number // newest message either direction (list position + range anchor)
  lastIncomingTs: number // newest message FROM them (drives the nav/feed badge)
  messages: DMMessage[] // ascending by created_at
  historyLoaded: boolean
}

// ── Seen-state (cross-device) ──────────────────────────────────────────────
// Two synced timestamps describe the span of the inbox you've opened:
//   seenLatest = newest chat you've opened, seenOldest = oldest chat you've opened.
// List dot: T>seenLatest OR T<seenOldest → purple; between → gray; at an end → none.
// Nav/feed badge: only incoming activity NEWER than seenLatest counts, so old
// chats below seenOldest never keep the badge lit, and your own sends never do.
// Persisted as a kind-30078 event (timestamps only, no pubkeys → no DM-graph leak),
// cached in localStorage for instant boot.
const APP_DATA_KIND = 30078
const SEEN_DTAG = 'notifications_seen_at_nip04_dms'
const SEEN_KEY = 'degmods:dm-seen-nip04'
const MAX_PER_CONV = 1000

function loadSeenCache(): { seenLatest: number; seenOldest: number } {
  try {
    const o = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}')
    return { seenLatest: Number(o?.seenLatest) || 0, seenOldest: Number(o?.seenOldest) || 0 }
  } catch { return { seenLatest: 0, seenOldest: 0 } }
}
function persistSeen(seenLatest: number, seenOldest: number) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ seenLatest, seenOldest })) } catch { /* ignore */ }
}

/** Dot for a conversation given the seen range. */
export function dmDotState(lastTs: number, seenLatest: number, seenOldest: number): 'purple' | 'gray' | 'none' {
  if (lastTs > seenLatest) return 'purple'
  if (seenOldest > 0 && lastTs < seenOldest) return 'purple'
  if (lastTs === seenLatest || lastTs === seenOldest) return 'none'
  return 'gray'
}

// Debounced publish so a burst of opens coalesces into one 30078 write.
let publishTimer: ReturnType<typeof setTimeout> | null = null
function schedulePublish() {
  if (publishTimer) clearTimeout(publishTimer)
  publishTimer = setTimeout(() => { publishTimer = null; void publishSeen() }, 8000)
}
async function publishSeen() {
  const { me, seenLatest, seenOldest } = useDMStore.getState()
  if (!me || (!seenLatest && !seenOldest)) return
  try {
    const signed = await signEvent({
      kind: APP_DATA_KIND,
      content: JSON.stringify({ seenLatest, seenOldest }),
      tags: [['d', SEEN_DTAG]],
      created_at: Math.floor(Date.now() / 1000),
      pubkey: me,
    })
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('write')
    await publishEvent(signed as unknown as NostrEvent, relays)
  } catch { /* non-fatal — the local cache already holds the state */ }
}

interface DMState {
  me: string | null
  conversations: Record<string, DMConversation>
  seenLatest: number
  seenOldest: number
  active: string | null
  historyLoaded: boolean
  loadingHistory: boolean
  /** True once the synced seen range has been fetched — the badge stays hidden
   *  until then so a stale local cache can't flash it on. */
  seenLoaded: boolean

  /** Fold a raw kind-4 event into its conversation (no decryption). */
  ingest: (ev: NostrEvent) => void
  /** Start the app-wide open subscription (both directions) + backfill. Returns a stop fn. */
  start: (me: string) => () => void
  /** Backfill recent DM history so the list is complete, not just this session. */
  loadHistory: () => Promise<void>
  /** Pull the synced seen range and merge it into local. */
  loadSeen: () => Promise<void>
  /** Widen the seen range to include `ts` (opening a chat / sending). */
  extendSeen: (ts: number) => void
  /** Open a conversation: fetch its full history and advance the seen range. */
  openConversation: (pubkey: string) => Promise<void>
  closeConversation: () => void

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
  seenLatest: loadSeenCache().seenLatest,
  seenOldest: loadSeenCache().seenOldest,
  active: null,
  historyLoaded: false,
  loadingHistory: false,
  seenLoaded: false,

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
    void get().loadSeen()
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

  loadSeen: async () => {
    const me = get().me
    if (!me) return
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const ev = await fetchLatestEvent(relays, { kinds: [APP_DATA_KIND], authors: [me], '#d': [SEEN_DTAG] })
      if (ev) {
        const o = JSON.parse(ev.content)
        const rl = Number(o?.seenLatest) || 0
        const ro = Number(o?.seenOldest) || 0
        set((s) => {
          const seenLatest = Math.max(s.seenLatest, rl)
          const seenOldest = s.seenOldest > 0
            ? (ro > 0 ? Math.min(s.seenOldest, ro) : s.seenOldest)
            : ro
          persistSeen(seenLatest, seenOldest)
          return { seenLatest, seenOldest }
        })
      }
    } catch { /* no synced state yet */ } finally {
      // Mark loaded whether or not a marker existed, so the badge can now decide.
      set({ seenLoaded: true })
    }
  },

  extendSeen: (ts) => {
    if (!ts || ts <= 0) return
    const s = get()
    const seenLatest = Math.max(s.seenLatest, ts)
    const seenOldest = s.seenOldest > 0 ? Math.min(s.seenOldest, ts) : ts
    if (seenLatest === s.seenLatest && seenOldest === s.seenOldest) return
    persistSeen(seenLatest, seenOldest)
    set({ seenLatest, seenOldest })
    schedulePublish()
  },

  openConversation: async (pubkey) => {
    set({ active: pubkey })
    const cur = get().conversations[pubkey]
    if (cur) get().extendSeen(cur.lastTs)
    const me = get().me
    if (!me || cur?.historyLoaded) return
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
      get().extendSeen(get().conversations[pubkey]?.lastTs ?? 0)
    }
  },

  closeConversation: () => set({ active: null }),

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
    // Sending a message means I'm caught up here — advance the range past it.
    get().extendSeen(signed.created_at)
  },

  reset: () => set({ me: null, conversations: {}, active: null, historyLoaded: false, loadingHistory: false, seenLoaded: false }),
}))

/** Badge hook: true when the seen range is loaded AND a non-blocked conversation
 *  has an incoming message newer than seenLatest. Gated on seenLoaded (no stale
 *  flash) and block-aware (blocked people never light the badge). */
export function useHasUnreadDM(): boolean {
  const seenLoaded = useDMStore((s) => s.seenLoaded)
  const conversations = useDMStore((s) => s.conversations)
  const seenLatest = useDMStore((s) => s.seenLatest)
  const blocked = useBlockStore((s) => s.blockedPubkeys)
  return seenLoaded && Object.values(conversations).some(
    (c) => !blocked.has(c.pubkey) && c.lastIncomingTs > seenLatest,
  )
}
