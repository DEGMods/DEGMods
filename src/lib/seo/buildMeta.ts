/**
 * SEO meta builder — pure, so the client head hook (and any future prerender
 * step) can share the exact same logic. See docs on SEO discoverability.
 */

export const SITE_NAME = 'DEG MODS'
export const DEFAULT_DESCRIPTION = 'DEG MODS — decentralized game mods on Nostr.'
const MAX_DESCRIPTION = 160

export interface SeoInput {
  /** Page title (site name is appended automatically). */
  title?: string
  /** Description (collapsed + truncated to ~160 chars). */
  description?: string
  /** Absolute image URL (used for og:image when present). */
  image?: string
  /** Open Graph type: 'website' | 'article' | 'profile'. */
  type?: string
  /** Absolute canonical URL; defaults to the current location. */
  canonical?: string
}

export interface SeoMeta {
  title: string
  description: string
  type: string
  canonical?: string
  image?: string
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + '…'
}

export function buildMeta(input: SeoInput = {}): SeoMeta {
  return {
    title: input.title ? `${input.title} — ${SITE_NAME}` : SITE_NAME,
    description: truncate(input.description || DEFAULT_DESCRIPTION, MAX_DESCRIPTION),
    type: input.type || 'website',
    canonical: input.canonical,
    image: input.image,
  }
}
