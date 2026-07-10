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
