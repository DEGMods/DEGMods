/**
 * Types for Blog Posts (Kind 30023)
 */

export interface BlogDetails {
  id: string
  pubkey: string
  dTag: string
  title: string
  summary: string
  content: string  // markdown
  publishedAt: number
  createdAt: number
  featuredImageUrl?: string
  tags: string[]
  client?: string  // NIP-89 client tag (publishing app name)
  /**
   * NIP-36 content warning, if the post carries one. This client's editor has no
   * control for it, but a long-form post written elsewhere can be flagged, and
   * an admin can flag one after the fact via the kind-30985 moderation overlay —
   * so it's read rather than assumed absent.
   */
  contentWarning?: string
  isDeleted: boolean
  aTag: string     // 30023:<pubkey>:<d-tag>
}

export interface BlogFormState {
  dTag: string
  title: string
  summary: string
  content: string
  featuredImageUrl: string
  tags: string[]
  isEdit: boolean
  previousCreatedAt?: number
  publishedAt?: number
}

export function createEmptyBlogFormState(): BlogFormState {
  return {
    dTag: crypto.randomUUID(),
    title: '',
    summary: '',
    content: '',
    featuredImageUrl: '',
    tags: [''],
    isEdit: false,
  }
}
