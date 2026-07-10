import { create } from 'zustand'

/** Controls the full-screen login overlay so any "log in" trigger can open it
 *  without navigating away from the current page. */
interface LoginModalState {
  isOpen: boolean
  open: () => void
  close: () => void
}

export const useLoginModalStore = create<LoginModalState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}))
