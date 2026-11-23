import { createContext, useContext } from 'react'

/**
 * A page's theme accent. Mod pages are purple, mod-request (bounty) pages are
 * orange, and mod jams are watermelon. Shared widgets (comments, share box, …)
 * read this so a reused component matches whichever page it sits on.
 */
export type Accent = 'purple' | 'orange' | 'watermelon'

export interface AccentClasses {
  /** Accent-colored text (icons, labels). */
  text: string
  /** `hover:text-<accent>` for interactive text. */
  textHover: string
  /** Solid accent button background + hover. */
  solid: string
  /** Small solid accent background (badges/dots). */
  badge: string
  /** Spinner / loader text color. */
  loader: string
}

// Class strings are written as literals so Tailwind's content scan keeps them.
export const ACCENTS: Record<Accent, AccentClasses> = {
  purple: {
    text: 'text-purple-400',
    textHover: 'hover:text-purple-400',
    solid: 'bg-purple-600 hover:bg-purple-700',
    badge: 'bg-purple-600',
    loader: 'text-purple-500',
  },
  orange: {
    text: 'text-orange-400',
    textHover: 'hover:text-orange-400',
    solid: 'bg-orange-600 hover:bg-orange-700',
    badge: 'bg-orange-600',
    loader: 'text-orange-500',
  },
  watermelon: {
    text: 'text-[#fc4462]',
    textHover: 'hover:text-[#fc4462]',
    solid: 'bg-[#fc4462] hover:bg-[#e23a56]',
    badge: 'bg-[#fc4462]',
    loader: 'text-[#fc4462]',
  },
}

const AccentContext = createContext<Accent>('purple')
export const AccentProvider = AccentContext.Provider

/** Resolve the current accent's class set. Defaults to purple. */
export function useAccent(): AccentClasses {
  return ACCENTS[useContext(AccentContext)]
}
