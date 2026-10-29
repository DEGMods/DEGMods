/**
 * DEN Chat hubs (NIP-CHAT, kind 36942) + the admin's recommended-hubs list.
 *
 * DEG Mods can't join a hub (that needs DEN Chat's key exchange) — it only reads
 * a hub's public "face" (always plaintext, no key needed) to preview and link to
 * it, and the admin curates a short recommended list shown on the landing page.
 */
import { nip19, type Event as NostrEvent, type UnsignedEvent } from 'nostr-tools'
import { buildNip78ListEvent } from '@/lib/nostr/events'

/** DEN Chat hub — addressable, so one coordinate survives every edit. */
export const HUB_KIND = 36942

/** Admin NIP-78 list (kind 30078) of recommended hubs, in display order. */
export const HUB_RECOMMENDATIONS_DTAG = '36942-hub-recommendations'

export interface Hub {
  name: string
  description?: string
  icon?: string
  banner?: string
  topics: string[]
  nsfw: boolean
  minPow: number
  /** The hub's advertised relays (`r` tags), for naddr relay hints. */
  relays: string[]
  /** 2 = v2 hub, 1/absent = v1. Only useful as an optional badge. */
  version: number
}

/**
 * Read a hub event's public fields.
 *
 * Identity/moderation live in tags (`n` name, `t` topics, `content-warning`, `w`
 * min PoW). Presentation is `settings.*` in the JSON content on older v1 hubs,
 * and the `about`/`picture`/`banner` tags on all v2 + newer v1 hubs — the tags
 * take precedence when present, which covers every case. Anything missing is just
 * absent; a hub with only a name is still valid.
 */
export function parseHubEvent(ev: NostrEvent): Hub {
  let settings: Record<string, unknown> = {}
  try {
    settings = (JSON.parse(ev.content) as { settings?: Record<string, unknown> })?.settings ?? {}
  } catch { /* content is optional and may be anything */ }

  const tag = (k: string) => ev.tags.find((t) => t[0] === k)?.[1]
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)

  return {
    name: tag('n') || tag('d') || 'Unnamed hub',
    description: str(tag('about')) ?? str(settings.description),
    icon: str(tag('picture')) ?? str(settings.icon),
    banner: str(tag('banner')) ?? str(settings.banner),
    topics: ev.tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]).slice(0, 6),
    nsfw: ev.tags.some((t) => t[0] === 'content-warning'),
    minPow: Number(tag('w')) || 0,
    relays: ev.tags.filter((t) => t[0] === 'r' && t[1]).map((t) => t[1]).slice(0, 3),
    version: Number(tag('version')) || 1,
  }
}

export interface HubRec {
  coord: string
  pubkey: string
  dTag: string
  relayHint?: string
}

/** Ordered recommended-hub coordinates from the admin's NIP-78 list event. */
export function parseHubRecommendations(ev: NostrEvent | null | undefined): HubRec[] {
  if (!ev) return []
  const out: HubRec[] = []
  const seen = new Set<string>()
  for (const t of ev.tags) {
    if (t[0] !== 'a' || !t[1]) continue
    const m = /^36942:([0-9a-f]{64}):(.+)$/i.exec(t[1].trim())
    if (!m) continue
    const coord = `${HUB_KIND}:${m[1]}:${m[2]}`
    if (seen.has(coord)) continue
    seen.add(coord)
    out.push({ coord, pubkey: m[1], dTag: m[2], relayHint: t[2] || undefined })
  }
  return out
}

/** Build the admin's recommended-hub list — a-tags with an optional relay hint, in order. */
export function buildHubRecommendationsEvent(
  recs: { coord: string; relayHint?: string }[],
): UnsignedEvent {
  return buildNip78ListEvent(
    HUB_RECOMMENDATIONS_DTAG,
    recs.map((r) => (r.relayHint ? ['a', r.coord, r.relayHint] : ['a', r.coord])),
  )
}

/** Decode a hub naddr (or a raw 36942 coordinate) → coordinate + optional relay hint. */
export function parseHubNaddr(
  input: string,
): { coord: string; pubkey: string; dTag: string; relayHint?: string } | { error: string } {
  const value = input.trim()
  if (!value) return { error: 'Enter a hub naddr' }

  const raw = /^36942:([0-9a-f]{64}):(.+)$/i.exec(value)
  if (raw) return { coord: `${HUB_KIND}:${raw[1]}:${raw[2]}`, pubkey: raw[1], dTag: raw[2] }

  try {
    const decoded = nip19.decode(value)
    if (decoded.type !== 'naddr') return { error: 'Not an naddr address' }
    const { kind, pubkey, identifier, relays } = decoded.data
    if (kind !== HUB_KIND) return { error: `naddr is kind ${kind}, expected a DEN Chat hub (36942)` }
    return { coord: `${HUB_KIND}:${pubkey}:${identifier}`, pubkey, dTag: identifier, relayHint: relays?.[0] }
  } catch {
    return { error: 'Invalid naddr' }
  }
}

/** naddr for opening/copying a hub, carrying up to 3 relay hints. */
export function hubNaddr(pubkey: string, dTag: string, relays?: string[]): string | null {
  try {
    return nip19.naddrEncode({ kind: HUB_KIND, pubkey, identifier: dTag, relays: relays?.slice(0, 3) })
  } catch {
    return null
  }
}
