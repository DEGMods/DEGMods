/**
 * Adult confirmation for anything that would show sensitive media.
 *
 * Asked once, then remembered locally. Nothing is published, sent anywhere, or
 * tied to an account — a reader's age is not the site's business beyond letting
 * them answer the question, and asking a second time would just train people to
 * dismiss it.
 *
 * The gate wraps an *action* rather than guarding a piece of state. Anything
 * that would uncover sensitive media routes through `request()`, which either
 * runs it straight away (already confirmed) or holds it until the reader
 * answers. Declining drops the action entirely, so the toggle doesn't flip, the
 * filter doesn't change, and the media stays covered — the state never moves.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AgeGateState {
  /** Persisted: the reader has confirmed they're a legal adult. */
  confirmed: boolean
  /** Transient: the action waiting on an answer. Non-null ⇒ dialog is open. */
  pending: (() => void) | null

  /** Run `action`, asking first if we haven't already. */
  request: (action: () => void) => void
  /** Confirmed — remember it and run whatever was waiting. */
  accept: () => void
  /** Declined — discard the action so nothing changes. */
  decline: () => void
  /** Undo the confirmation (used when NSFW media is switched back off). */
  reset: () => void
}

export const useAgeGateStore = create<AgeGateState>()(
  persist(
    (set, get) => ({
      confirmed: false,
      pending: null,

      request: (action) => {
        if (get().confirmed) { action(); return }
        // Stored via an updater so zustand keeps the function as state rather
        // than treating it as a setState callback.
        set({ pending: () => action() })
      },

      accept: () => {
        const { pending } = get()
        set({ confirmed: true, pending: null })
        pending?.()
      },

      decline: () => set({ pending: null }),

      reset: () => set({ confirmed: false, pending: null }),
    }),
    {
      name: 'deg-mods:age-gate',
      // Only the answer is remembered; a half-finished action must not survive.
      partialize: (s) => ({ confirmed: s.confirmed }),
    },
  ),
)

/** Run an action behind the adult check. Safe to call from anywhere. */
export function requestAdult(action: () => void): void {
  useAgeGateStore.getState().request(action)
}
