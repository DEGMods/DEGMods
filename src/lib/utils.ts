import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isTauri(): boolean {
  return false // web-only: no Tauri desktop support
}

/**
 * True for a well-formed http(s) URL — the bar for rendering user-supplied text
 * as a clickable link. Stricter than a prefix test: it must also parse and have
 * a host, so "https://" or "http://  " don't slip through.
 */
export function isHttpUrl(value: string): boolean {
  const v = value.trim()
  if (!/^https?:\/\//i.test(v)) return false
  try {
    return !!new URL(v).host
  } catch {
    return false
  }
}

export function truncateNpub(npub: string, chars = 8): string {
  if (npub.length <= chars * 2 + 3) return npub
  return `${npub.slice(0, chars)}...${npub.slice(-chars)}`
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: true }

  if (isToday) {
    return date.toLocaleTimeString([], timeOpts)
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${date.toLocaleTimeString([], timeOpts)}`
  }

  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + date.toLocaleTimeString([], timeOpts)
}

export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(timestamp * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}
