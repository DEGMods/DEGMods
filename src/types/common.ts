/**
 * Common types shared across the app
 */

export interface PaginationState {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface SortOption {
  label: string
  value: string
}

export const SORT_OPTIONS = {
  NEWEST: 'newest',
  OLDEST: 'oldest',
  MOST_ZAPPED: 'most_zapped',
} as const

export type SortValue = typeof SORT_OPTIONS[keyof typeof SORT_OPTIONS]
