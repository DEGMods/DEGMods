/**
 * Admin API client for a DEG Mods node (blossom-relay-server).
 *
 * Every request is authenticated with NIP-98 (a signed kind-27235 event) or, for
 * blob deletion, a kind-24242 `t=delete` event — both signed in-browser via the
 * logged-in signer (NIP-07). No raw key is ever handled here.
 */

import { signEvent } from '@/stores/authStore'

// Managed nodes. Built as lists so more nodes can be added later; today it's just
// the DEG Mods node (same host serves blossom over https and the relay over wss).
export interface ManagedNode { label: string; url: string }
export const MANAGED_BLOSSOMS: ManagedNode[] = [
  { label: 'brs.degmods.com', url: 'https://brs.degmods.com' },
]
export const MANAGED_RELAYS: ManagedNode[] = [
  { label: 'brs.degmods.com', url: 'wss://brs.degmods.com' },
]

const now = () => Math.floor(Date.now() / 1000)
const nostrAuth = (evt: Record<string, unknown>) => 'Nostr ' + btoa(JSON.stringify(evt))

/** Build a NIP-98 Authorization header for (url, method). */
async function nip98Header(url: string, method: string): Promise<string> {
  const evt = await signEvent({
    kind: 27235,
    created_at: now(),
    tags: [['u', url], ['method', method.toUpperCase()]],
    content: '',
  })
  return nostrAuth(evt)
}

async function reason(res: Response): Promise<string> {
  return res.headers.get('X-Reason') || `${res.status} ${res.statusText}`
}

async function adminFetch(nodeUrl: string, path: string, method: string, body?: unknown): Promise<Response> {
  const url = `${nodeUrl.replace(/\/+$/, '')}${path}`
  const headers: Record<string, string> = { Authorization: await nip98Header(url, method) }
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  return fetch(url, init)
}

// ─── Types ──────────────────────────────────────────────────────────

export interface AdminBlob { hash: string; ext: string; size: number; url: string; added: number }
export interface BlobsPage { total: number; page: number; per: number; pages: number; types: string[]; blobs: AdminBlob[] }
export type BlobSort = 'hash' | 'size' | 'date'
export interface WhitelistEntry { pubkey: string; note?: string }
export interface WhitelistInfo { limit_mb: number; whitelisted_mb: number; entries: WhitelistEntry[] }

// ─── Blobs ──────────────────────────────────────────────────────────

export async function listBlobs(
  nodeUrl: string,
  opts: { search?: string; ext?: string[]; sort?: BlobSort; dir?: 'asc' | 'desc'; page?: number; per?: number } = {},
): Promise<BlobsPage> {
  const q = new URLSearchParams()
  if (opts.search) q.set('search', opts.search)
  if (opts.ext?.length) q.set('ext', opts.ext.join(','))
  if (opts.sort) q.set('sort', opts.sort)
  if (opts.dir) q.set('dir', opts.dir)
  if (opts.page) q.set('page', String(opts.page))
  if (opts.per) q.set('per', String(opts.per))
  const res = await adminFetch(nodeUrl, `/admin/blobs?${q.toString()}`, 'GET')
  if (!res.ok) throw new Error(await reason(res))
  return res.json()
}

/** Delete a blob (Blossom kind-24242 `t=delete`, admin-signed). */
export async function deleteBlob(nodeUrl: string, hash: string): Promise<void> {
  const evt = await signEvent({
    kind: 24242,
    created_at: now(),
    tags: [['t', 'delete'], ['x', hash], ['expiration', String(now() + 300)]],
    content: 'delete',
  })
  const res = await fetch(`${nodeUrl.replace(/\/+$/, '')}/${hash}`, {
    method: 'DELETE',
    headers: { Authorization: nostrAuth(evt) },
  })
  if (!res.ok) throw new Error(await reason(res))
}

// ─── Upload-size whitelist ──────────────────────────────────────────

export async function getWhitelist(nodeUrl: string): Promise<WhitelistInfo> {
  const res = await adminFetch(nodeUrl, '/admin/whitelist', 'GET')
  if (!res.ok) throw new Error(await reason(res))
  return res.json()
}

export async function addWhitelist(nodeUrl: string, pubkey: string, note?: string): Promise<void> {
  const res = await adminFetch(nodeUrl, '/admin/whitelist', 'POST', { pubkey, note })
  if (!res.ok) throw new Error(await reason(res))
}

export async function removeWhitelist(nodeUrl: string, pubkey: string): Promise<void> {
  const res = await adminFetch(nodeUrl, '/admin/whitelist', 'DELETE', { pubkey })
  if (!res.ok) throw new Error(await reason(res))
}

// ─── Relay management (NIP-86) ──────────────────────────────────────

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Call a NIP-86 relay-management method (auth = NIP-98 with a payload hash). */
async function nip86(relayWss: string, method: string, params: unknown[]): Promise<unknown> {
  const httpUrl = relayWss.replace(/^ws/, 'http').replace(/\/+$/, '')
  const body = JSON.stringify({ method, params })
  const evt = await signEvent({
    kind: 27235,
    created_at: now(),
    tags: [['u', httpUrl], ['method', 'POST'], ['payload', await sha256Hex(body)]],
    content: '',
  })
  const res = await fetch(httpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/nostr+json+rpc', Authorization: nostrAuth(evt) },
    body,
  })
  if (!res.ok) throw new Error(await reason(res))
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.result
}

export interface BannedPubkey { pubkey: string; reason?: string }

export async function listBannedPubkeys(relayWss: string): Promise<BannedPubkey[]> {
  const r = await nip86(relayWss, 'listbannedpubkeys', [])
  return Array.isArray(r) ? (r as BannedPubkey[]) : []
}
export async function banPubkey(relayWss: string, pubkey: string, reason: string): Promise<void> {
  await nip86(relayWss, 'banpubkey', [pubkey, reason])
}
export async function allowPubkey(relayWss: string, pubkey: string): Promise<void> {
  await nip86(relayWss, 'allowpubkey', [pubkey])
}

// ─── Event takedowns (persistent, address-based; NIP-98 admin API) ───

export interface BannedEventEntry { key: string; reason?: string }

/** The ban key for an event: its addressable coordinate, or id if not addressable. */
export function eventBanKey(e: { kind: number; pubkey: string; id: string; tags: string[][] }): string {
  const d = e.tags.find((t) => t[0] === 'd')?.[1]
  return d ? `${e.kind}:${e.pubkey}:${d}` : e.id
}

/** nodeHttp is the node's https base (derive from a wss relay via wsToHttp). */
export async function banEventKey(nodeHttp: string, key: string, note = ''): Promise<void> {
  const res = await adminFetch(nodeHttp, '/admin/banned-events', 'POST', { key, reason: note })
  if (!res.ok) throw new Error(await reason(res))
}
export async function listBannedEvents(nodeHttp: string): Promise<BannedEventEntry[]> {
  const res = await adminFetch(nodeHttp, '/admin/banned-events', 'GET')
  if (!res.ok) throw new Error(await reason(res))
  const j = await res.json()
  return j.entries ?? []
}
export async function unbanEvent(nodeHttp: string, key: string): Promise<void> {
  const res = await adminFetch(nodeHttp, '/admin/banned-events', 'DELETE', { key })
  if (!res.ok) throw new Error(await reason(res))
}

/** wss://host → https://host (the relay and its admin API share a host). */
export function wsToHttp(wss: string): string {
  return wss.replace(/^ws/, 'http')
}

// ─── Download-gate ad inventory (node-signed NIP-78; BUD-Ads target) ─

/** One ad in the node's download-gate inventory (mirrors the node's adItem). */
export interface NodeAdButton { text: string; link: string }
export interface NodeAdItem { id: string; media: string; link?: string; alt?: string; weight?: number; buttons?: NodeAdButton[] }
export interface NodeAdsInfo {
  ref: string                 // 30078:<node-pubkey>:manual-blossom-ads
  publish_relays: string[]
  ads: NodeAdItem[]
  event?: unknown | null      // last node-signed inventory event
}

/** Read the node's current download-gate ad inventory. */
export async function getNodeAds(nodeUrl: string): Promise<NodeAdsInfo> {
  const res = await adminFetch(nodeUrl, '/admin/ads', 'GET')
  if (!res.ok) throw new Error(await reason(res))
  return res.json()
}

/** Publish a new inventory: the node signs it with its own key and broadcasts it. */
export async function saveNodeAds(nodeUrl: string, ads: NodeAdItem[]): Promise<NodeAdsInfo & { published_to: number }> {
  const res = await adminFetch(nodeUrl, '/admin/ads', 'PUT', { ads })
  if (!res.ok) throw new Error(await reason(res))
  return res.json()
}

export interface AdStats { views: Record<string, number>; clicks: Record<string, number> }

/** Per-ad view/click counts. Public `/ads/stats` (aggregate-only, no IPs); it only
 *  exists while the ad gate is enabled, so callers should handle a failure/absence. */
export async function getAdStats(nodeUrl: string): Promise<AdStats> {
  const res = await fetch(`${nodeUrl.replace(/\/+$/, '')}/ads/stats`)
  if (!res.ok) throw new Error(await reason(res))
  const j = await res.json()
  return { views: j.views ?? {}, clicks: j.clicks ?? {} }
}

// ─── helpers ────────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}
