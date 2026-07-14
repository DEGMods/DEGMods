import { create } from 'zustand'
import type { Event as NostrEvent } from 'nostr-tools'
import { fetchEvents, fetchLatestEvent, subscribe, publishEvent } from '@/lib/nostr/relay-pool'
import { signEvent, useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useBlockStore } from '@/stores/blockStore'
import { GIFT_WRAP_KIND, unwrapFirstLayer, unseal, sendGiftWrap } from '@/lib/nostr/nip17'
import { dmDotState, type DMConversation, type DMMessage } from '@/stores/dmStore'

// ── NIP-17 messages carry the seal ciphertext for the on-demand second layer ──
export interface DM17Message extends DMMessage {
  sealPubkey: string // the real sender (from the peeled seal)
  sealContent: string // still-encrypted rumor (decrypt = message text)
}
type DM17Conversation = Omit<DMConversation, 'messages'> & { messages: DM17Message[] }

/** An undecrypted gift wrap (first layer not yet peeled). `failed` marks wraps
 *  that couldn't be unwrapped (not a NIP-17 DM / bad encryption) so they're
 *  skipped rather than halting the run. */
interface PendingWrap { id: string; pubkey: string; content: string; created_at: number; failed?: boolean }

// Set by cancelFirstLayer() to stop an in-progress peel between wraps.
let cancelPeel = false

// Seen-state (own d-tag so NIP-04/NIP-17 track independently).
const APP_DATA_KIND = 30078
const SEEN_DTAG = 'notifications_seen_at_nip17_dms'
const SEEN_KEY = 'degmods:dm-seen-nip17'
const MAX_PER_CONV = 1000

function loadSeenCache(): { seenLatest: number; seenOldest: number } {
  try { const o = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); return { seenLatest: Number(o?.seenLatest) || 0, seenOldest: Number(o?.seenOldest) || 0 } }
  catch { return { seenLatest: 0, seenOldest: 0 } }
}
function persistSeen(seenLatest: number, seenOldest: number) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ seenLatest, seenOldest })) } catch { /* ignore */ }
}

let publishTimer: ReturnType<typeof setTimeout> | null = null
function schedulePublish() {
  if (publishTimer) clearTimeout(publishTimer)
  publishTimer = setTimeout(() => { publishTimer = null; void publishSeen() }, 8000)
}
async function publishSeen() {
  const { me, seenLatest, seenOldest } = useDM17Store.getState()
  if (!me || (!seenLatest && !seenOldest)) return
  try {
    const signed = await signEvent({ kind: APP_DATA_KIND, content: JSON.stringify({ seenLatest, seenOldest }), tags: [['d', SEEN_DTAG]], created_at: Math.floor(Date.now() / 1000), pubkey: me })
    await publishEvent(signed as unknown as NostrEvent, useSettingsStore.getState().getAllEnabledRelayUrls('write'))
  } catch { /* non-fatal */ }
}

interface DM17State {
  me: string | null
  conversations: Record<string, DM17Conversation>
  pending: Record<string, PendingWrap>
  seenLatest: number
  seenOldest: number
  seenLoaded: boolean
  active: string | null
  loadingHistory: boolean
  /** First-layer decrypt run in progress + progress + whether it stopped on a denial. */
  peeling: boolean
  peelProgress: { done: number; total: number }
  peelStopped: boolean

  ingestWrap: (ev: NostrEvent) => void
  start: (me: string) => () => void
  loadHistory: () => Promise<void>
  loadSeen: () => Promise<void>
  extendSeen: (ts: number) => void
  /** Peel every pending wrap's first layer, one signer request at a time. Skips
   *  wraps that can't be unwrapped (not NIP-17 DMs) and keeps going; call
   *  cancelFirstLayer() to stop. */
  decryptFirstLayerAll: () => Promise<void>
  cancelFirstLayer: () => void
  openConversation: (pubkey: string) => void
  closeConversation: () => void
  decryptMessage: (pubkey: string, id: string) => Promise<void>
  decryptConversation: (pubkey: string) => Promise<void>
  decryptAll: () => Promise<void>
  send: (recipient: string, text: string) => Promise<void>
  reset: () => void
}

function upsert(conv: DM17Conversation | undefined, pubkey: string, msg: DM17Message): DM17Conversation {
  const base: DM17Conversation = conv ?? { pubkey, lastTs: 0, lastIncomingTs: 0, messages: [], historyLoaded: true }
  if (base.messages.some((m) => m.id === msg.id)) return base
  let messages = [...base.messages, msg].sort((a, b) => a.created_at - b.created_at)
  if (messages.length > MAX_PER_CONV) messages = messages.slice(messages.length - MAX_PER_CONV)
  return { ...base, messages, lastTs: Math.max(base.lastTs, msg.created_at), lastIncomingTs: msg.mine ? base.lastIncomingTs : Math.max(base.lastIncomingTs, msg.created_at) }
}

export const useDM17Store = create<DM17State>((set, get) => ({
  me: null,
  conversations: {},
  pending: {},
  seenLatest: loadSeenCache().seenLatest,
  seenOldest: loadSeenCache().seenOldest,
  seenLoaded: false,
  active: null,
  loadingHistory: false,
  peeling: false,
  peelProgress: { done: 0, total: 0 },
  peelStopped: false,

  ingestWrap: (ev) => {
    if (ev.kind !== GIFT_WRAP_KIND) return
    // Skip if already pending or already peeled into a conversation.
    if (get().pending[ev.id]) return
    const seen = Object.values(get().conversations).some((c) => c.messages.some((m) => m.id === ev.id))
    if (seen) return
    set((s) => ({ pending: { ...s.pending, [ev.id]: { id: ev.id, pubkey: ev.pubkey, content: ev.content, created_at: ev.created_at } } }))
  },

  start: (me) => {
    set({ me })
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    const sub = subscribe(relays, { kinds: [GIFT_WRAP_KIND], '#p': [me] }, (ev) => get().ingestWrap(ev))
    void get().loadHistory()
    void get().loadSeen()
    return () => { sub.close() }
  },

  loadHistory: async () => {
    const me = get().me
    if (!me || get().loadingHistory) return
    set({ loadingHistory: true })
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const wraps = await fetchEvents(relays, { kinds: [GIFT_WRAP_KIND], '#p': [me], limit: 400 }, 8000)
      for (const ev of wraps) get().ingestWrap(ev)
    } catch { /* best-effort */ } finally {
      set({ loadingHistory: false })
    }
  },

  loadSeen: async () => {
    const me = get().me
    if (!me) return
    try {
      const ev = await fetchLatestEvent(useSettingsStore.getState().getAllEnabledRelayUrls('read'), { kinds: [APP_DATA_KIND], authors: [me], '#d': [SEEN_DTAG] })
      if (ev) {
        const o = JSON.parse(ev.content)
        const rl = Number(o?.seenLatest) || 0
        const ro = Number(o?.seenOldest) || 0
        set((s) => {
          const seenLatest = Math.max(s.seenLatest, rl)
          const seenOldest = s.seenOldest > 0 ? (ro > 0 ? Math.min(s.seenOldest, ro) : s.seenOldest) : ro
          persistSeen(seenLatest, seenOldest)
          return { seenLatest, seenOldest }
        })
      }
    } catch { /* none yet */ } finally {
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

  decryptFirstLayerAll: async () => {
    if (get().peeling) return
    const me = get().me
    if (!me) return
    cancelPeel = false
    // Only attempt wraps we haven't already given up on.
    const ids = Object.keys(get().pending).filter((id) => !get().pending[id]?.failed)
    set({ peeling: true, peelStopped: false, peelProgress: { done: 0, total: ids.length } })
    try {
      for (let i = 0; i < ids.length; i++) {
        if (cancelPeel) { set({ peelStopped: true }); break }
        const p = get().pending[ids[i]]
        if (!p || p.failed) { set((s) => ({ peelProgress: { done: i + 1, total: s.peelProgress.total } })); continue }
        try {
          const { sender, sealContent } = await unwrapFirstLayer({ id: p.id, pubkey: p.pubkey, content: p.content, created_at: p.created_at, kind: GIFT_WRAP_KIND, tags: [], sig: '' } as NostrEvent)
          if (sender !== me) {
            // Received: place under the real sender; text stays encrypted (second layer).
            const msg: DM17Message = { id: p.id, from: sender, created_at: p.created_at, ciphertext: sealContent, mine: false, sealPubkey: sender, sealContent }
            set((s) => { const { [p.id]: _drop, ...pending } = s.pending; return { pending, conversations: { ...s.conversations, [sender]: upsert(s.conversations[sender], sender, msg) } } })
          } else {
            // My own copy: unseal now to learn the recipient + show my own text.
            const rumor = await unseal(sender, sealContent)
            const other = rumor.recipient
            const msg: DM17Message = { id: p.id, from: me, created_at: rumor.created_at, ciphertext: sealContent, mine: true, plaintext: rumor.content, sealPubkey: me, sealContent }
            set((s) => { const { [p.id]: _drop, ...pending } = s.pending; return other ? { pending, conversations: { ...s.conversations, [other]: upsert(s.conversations[other], other, msg) } } : { pending } })
          }
        } catch {
          // Not a NIP-17 DM (other app's gift wrap) or undecryptable — skip it and
          // keep going. Flag it so it isn't retried on the next run.
          set((s) => ({ pending: { ...s.pending, [p.id]: { ...s.pending[p.id], failed: true } } }))
        }
        set((s) => ({ peelProgress: { done: i + 1, total: s.peelProgress.total } }))
      }
    } finally {
      set({ peeling: false })
    }
  },
  cancelFirstLayer: () => { cancelPeel = true },

  openConversation: (pubkey) => {
    set({ active: pubkey })
    get().extendSeen(get().conversations[pubkey]?.lastTs ?? 0)
  },
  closeConversation: () => set({ active: null }),

  decryptMessage: async (pubkey, id) => {
    const conv = get().conversations[pubkey]
    const msg = conv?.messages.find((m) => m.id === id)
    if (!conv || !msg || msg.plaintext !== undefined) return
    const patch = (fields: Partial<DM17Message>) => set((s) => {
      const c = s.conversations[pubkey]; if (!c) return {}
      return { conversations: { ...s.conversations, [pubkey]: { ...c, messages: c.messages.map((m) => m.id === id ? { ...m, ...fields } : m) } } }
    })
    try {
      const rumor = await unseal(msg.sealPubkey, msg.sealContent)
      patch({ plaintext: rumor.content, created_at: rumor.created_at, error: false })
    } catch { patch({ error: true }) }
  },

  decryptConversation: async (pubkey) => {
    const conv = get().conversations[pubkey]
    if (!conv) return
    for (const m of conv.messages) {
      if (m.plaintext === undefined) {
        await get().decryptMessage(pubkey, m.id)
        if (get().conversations[pubkey]?.messages.find((x) => x.id === m.id)?.error) break // stop on denial
      }
    }
  },

  decryptAll: async () => {
    for (const pubkey of Object.keys(get().conversations)) {
      const conv = get().conversations[pubkey]
      if (!conv) continue
      for (const m of conv.messages) {
        if (m.plaintext === undefined) {
          await get().decryptMessage(pubkey, m.id)
          if (get().conversations[pubkey]?.messages.find((x) => x.id === m.id)?.error) return // stop on denial
        }
      }
    }
  },

  send: async (recipient, text) => {
    const me = useAuthStore.getState().pubkey!
    const { selfWrapId, createdAt } = await sendGiftWrap(recipient, text)
    const msg: DM17Message = { id: selfWrapId, from: me, created_at: createdAt, ciphertext: '', mine: true, plaintext: text, sealPubkey: me, sealContent: '' }
    set((s) => ({ conversations: { ...s.conversations, [recipient]: upsert(s.conversations[recipient], recipient, msg) } }))
    get().extendSeen(createdAt)
  },

  reset: () => set({ me: null, conversations: {}, pending: {}, active: null, seenLoaded: false, loadingHistory: false, peeling: false, peelStopped: false, peelProgress: { done: 0, total: 0 } }),
}))

export { dmDotState }

/** NIP-17 badge: unread if seen is loaded AND (there are undecrypted wraps OR a
 *  non-blocked conversation has incoming activity newer than seenLatest). */
export function useHasUnreadDM17(): boolean {
  const seenLoaded = useDM17Store((s) => s.seenLoaded)
  const hasPending = useDM17Store((s) => Object.values(s.pending).some((p) => !p.failed))
  const conversations = useDM17Store((s) => s.conversations)
  const seenLatest = useDM17Store((s) => s.seenLatest)
  const blocked = useBlockStore((s) => s.blockedPubkeys)
  if (!seenLoaded) return false
  if (hasPending) return true
  return Object.values(conversations).some((c) => !blocked.has(c.pubkey) && c.lastIncomingTs > seenLatest)
}
