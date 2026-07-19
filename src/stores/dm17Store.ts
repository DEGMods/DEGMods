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
// Set by cancelBatchDecrypt() to stop an in-progress "decrypt all" between messages.
let cancelBatch = false

// Seen-state (own d-tag so NIP-04/NIP-17 track independently).
const APP_DATA_KIND = 30078
const SEEN_DTAG = 'notifications_seen_at_nip17_dms'
const SEEN_KEY = 'degmods:dm-seen-nip17'
// Gift wraps the user has already been told about. A wrap can't be dated (its
// created_at is jittered) or read (the text is two layers down), so the only
// honest way to stop nagging about one is to remember we showed it.
const ACK_KEY = 'degmods:dm-ack-nip17'
const MAX_ACK = 2000

function loadAcked(): string[] {
  try { const a = JSON.parse(localStorage.getItem(ACK_KEY) || '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [] }
  catch { return [] }
}
function persistAcked(ids: Set<string>) {
  // Cap it: the list only exists to suppress repeat notifications, and an
  // unbounded one would grow with every gift wrap the account ever receives.
  try { localStorage.setItem(ACK_KEY, JSON.stringify([...ids].slice(-MAX_ACK))) } catch { /* ignore */ }
}
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
  /** Wrap ids already surfaced to the user, so they stop counting as unread. */
  ackedWraps: Set<string>
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
  /** Mark every currently-pending wrap as surfaced. */
  ackPending: () => void
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
  cancelBatchDecrypt: () => void
  send: (recipient: string, text: string) => Promise<void>
  reset: () => void
}

/**
 * Derive a conversation's timestamps from its messages.
 *
 * Always recomputed rather than accumulated with Math.max: an incoming message
 * enters carrying its *gift wrap's* created_at, which NIP-59 jitters up to two
 * days into the past, and only becomes the real (rumor) timestamp once the
 * second layer is decrypted. A running maximum would keep the stale wrapper
 * value forever.
 */
function timestamps(messages: DM17Message[]): { lastTs: number; lastIncomingTs: number } {
  let lastTs = 0
  let lastIncomingTs = 0
  for (const m of messages) {
    if (m.created_at > lastTs) lastTs = m.created_at
    if (!m.mine && m.created_at > lastIncomingTs) lastIncomingTs = m.created_at
  }
  return { lastTs, lastIncomingTs }
}

function upsert(conv: DM17Conversation | undefined, pubkey: string, msg: DM17Message): DM17Conversation {
  const base: DM17Conversation = conv ?? { pubkey, lastTs: 0, lastIncomingTs: 0, messages: [], historyLoaded: true }
  if (base.messages.some((m) => m.id === msg.id)) return base
  let messages = [...base.messages, msg].sort((a, b) => a.created_at - b.created_at)
  if (messages.length > MAX_PER_CONV) messages = messages.slice(messages.length - MAX_PER_CONV)
  return { ...base, messages, ...timestamps(messages) }
}

export const useDM17Store = create<DM17State>((set, get) => ({
  me: null,
  conversations: {},
  pending: {},
  seenLatest: loadSeenCache().seenLatest,
  seenOldest: loadSeenCache().seenOldest,
  seenLoaded: false,
  ackedWraps: new Set(loadAcked()),
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

  ackPending: () => {
    const { pending, ackedWraps } = get()
    const ids = Object.keys(pending)
    if (ids.length === 0 || ids.every((id) => ackedWraps.has(id))) return
    const next = new Set(ackedWraps)
    for (const id of ids) next.add(id)
    persistAcked(next)
    set({ ackedWraps: next })
  },

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
      const messages = c.messages
        .map((m) => m.id === id ? { ...m, ...fields } : m)
        .sort((a, b) => a.created_at - b.created_at)
      // Decryption replaces the gift wrap's timestamp with the rumor's, which is
      // the real one — so the conversation's own timestamps have to be redone,
      // not left pointing at the jittered wrapper value.
      return { conversations: { ...s.conversations, [pubkey]: { ...c, messages, ...timestamps(messages) } } }
    })
    try {
      const rumor = await unseal(msg.sealPubkey, msg.sealContent)
      patch({ plaintext: rumor.content, created_at: rumor.created_at, error: false })
    } catch { patch({ error: true }) }
  },

  decryptConversation: async (pubkey) => {
    const conv = get().conversations[pubkey]
    if (!conv) return
    cancelBatch = false
    // Skip messages that can't be decrypted (non-DM wraps) and keep going; stop if canceled.
    for (const m of conv.messages) {
      if (cancelBatch) break
      if (m.plaintext === undefined) await get().decryptMessage(pubkey, m.id)
    }
  },

  decryptAll: async () => {
    cancelBatch = false
    for (const pubkey of Object.keys(get().conversations)) {
      const conv = get().conversations[pubkey]
      if (!conv) continue
      for (const m of conv.messages) {
        if (cancelBatch) return
        if (m.plaintext === undefined) await get().decryptMessage(pubkey, m.id)
      }
    }
  },

  cancelBatchDecrypt: () => { cancelBatch = true },

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
  // Only wraps the user hasn't been shown yet. A pending wraps is undated (its
  // created_at is jittered) and unreadable until peeled, so it can't be compared
  // against seenLatest — without the ack list a wrap the user has no intention of
  // decrypting would light the dot permanently, with no way to clear it.
  const hasNewWraps = useDM17Store((s) =>
    Object.entries(s.pending).some(([id, p]) => !p.failed && !s.ackedWraps.has(id)),
  )
  const conversations = useDM17Store((s) => s.conversations)
  const seenLatest = useDM17Store((s) => s.seenLatest)
  const blocked = useBlockStore((s) => s.blockedPubkeys)
  if (!seenLoaded) return false
  if (hasNewWraps) return true
  return Object.values(conversations).some((c) => !blocked.has(c.pubkey) && c.lastIncomingTs > seenLatest)
}
