/**
 * Relay Discovery: fetches relay and blossom server lists from Nostr
 */

import type { Event as NostrEvent } from 'nostr-tools'
import { fetchEvents } from './relay-pool'
import { KINDS, type RelayConfig, type BlossomConfig } from '@/lib/constants'

const relayCache = new Map<string, { data: RelayConfig[]; ts: number }>()
const blossomCache = new Map<string, { data: BlossomConfig[]; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000

export async function fetchUserRelayList(
  pubkey: string,
  bootstrapRelays: string[]
): Promise<RelayConfig[]> {
  const cached = relayCache.get(pubkey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  const events = await fetchEvents(
    bootstrapRelays,
    { kinds: [KINDS.RELAY_LIST], authors: [pubkey], limit: 1 },
    5000
  )
  if (events.length === 0) return []

  const latest = events.sort((a, b) => b.created_at - a.created_at)[0]
  const relays = parseRelayListEvent(latest)
  relayCache.set(pubkey, { data: relays, ts: Date.now() })
  return relays
}

export async function fetchUserBlossomList(
  pubkey: string,
  bootstrapRelays: string[]
): Promise<BlossomConfig[]> {
  const cached = blossomCache.get(pubkey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  const events = await fetchEvents(
    bootstrapRelays,
    { kinds: [KINDS.BLOSSOM_LIST], authors: [pubkey], limit: 1 },
    5000
  )
  if (events.length === 0) return []

  const latest = events.sort((a, b) => b.created_at - a.created_at)[0]
  const servers = parseBlossomListEvent(latest)
  blossomCache.set(pubkey, { data: servers, ts: Date.now() })
  return servers
}

function parseRelayListEvent(event: NostrEvent): RelayConfig[] {
  return event.tags
    .filter(t => t[0] === 'r' && t[1])
    .map(t => {
      const marker = t[2]
      return {
        url: t[1],
        read: !marker || marker === 'read',
        write: !marker || marker === 'write',
        enabled: true,
      }
    })
}

function parseBlossomListEvent(event: NostrEvent): BlossomConfig[] {
  return event.tags
    .filter(t => t[0] === 'server' && t[1])
    .map(t => ({ url: t[1], enabled: true }))
}

export function clearRelayCache(pubkey?: string): void {
  if (pubkey) {
    relayCache.delete(pubkey)
    blossomCache.delete(pubkey)
  } else {
    relayCache.clear()
    blossomCache.clear()
  }
}
