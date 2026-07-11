/**
 * Event builders for DEG MODS
 *
 * All builders return UnsignedEvent objects ready to be signed.
 * pubkey is set to '': the signer fills it in.
 */

import type { UnsignedEvent } from 'nostr-tools'
import { KINDS, CLIENT_NAME, CATEGORY_MAX_DEPTH, CATEGORY_MAX_CHAINS, CATEGORY_SEGMENT_MAXLEN } from '@/lib/constants'
import { cacheEvent } from '@/lib/nostr/eventCache'
import type { ModFormState, DownloadEntry, PermissionsData } from '@/types/mod'
import type { BlogFormState } from '@/types/blog'

// ─── Categories (c = maximal chains, h = rooted prefixes, f = segments) ──
//
// Chains are JSON string-arrays so segments can be free text (including ":")
// without delimiter collisions. The UI keeps chains as ":"-joined strings; we
// split on encode and re-join on decode. See docs/game-mod-event.md.

/** Normalize a ":"-joined chain into capped, trimmed segments. */
function normalizeChain(raw: string): string[] {
  return raw
    .split(':')
    .map(s => s.trim().slice(0, CATEGORY_SEGMENT_MAXLEN))
    .filter(Boolean)
    .slice(0, CATEGORY_MAX_DEPTH)
}

/** True when chain `a` is a strict prefix of chain `b` (so `a` is implied by `b`). */
function isStrictPrefix(a: string[], b: string[]): boolean {
  return a.length < b.length && a.every((s, k) => s === b[k])
}

/** Encode category chains into deduped c/h/f tags. */
export function buildCategoryTags(chains: string[]): string[][] {
  const norm: string[][] = []
  const seenChain = new Set<string>()
  for (const raw of chains) {
    const segs = normalizeChain(raw)
    if (segs.length === 0) continue
    const key = JSON.stringify(segs)
    if (seenChain.has(key)) continue
    seenChain.add(key)
    norm.push(segs)
  }

  // Collapse: drop any chain that's a strict prefix of another — it's already
  // implied by the longer one (its h-prefix and f-segments are emitted anyway).
  const maximal = norm
    .filter((a, i) => !norm.some((b, j) => j !== i && isStrictPrefix(a, b)))
    .slice(0, CATEGORY_MAX_CHAINS)

  const tags: string[][] = []
  const hSeen = new Set<string>()
  const fSeen = new Set<string>()
  for (const segs of maximal) {
    tags.push(['c', JSON.stringify(segs)])                          // maximal chain
    for (let k = 1; k <= segs.length; k++) {                        // rooted prefixes
      const pj = JSON.stringify(segs.slice(0, k))
      if (!hSeen.has(pj)) { hSeen.add(pj); tags.push(['h', pj]) }
    }
    for (const s of segs) {                                         // segments
      if (!fSeen.has(s)) { fSeen.add(s); tags.push(['f', s]) }
    }
  }
  return tags
}

/**
 * For each ":"-joined chain, returns a note explaining why it's redundant
 * (a strict prefix of a longer chain, or an exact duplicate of an earlier one),
 * or null. The editor shows this to flag categories that won't be published
 * separately.
 */
export function categoryCovers(chains: string[]): (string | null)[] {
  const segs = chains.map(c => c.split(':').map(s => s.trim()).filter(Boolean))
  const equal = (a: string[], b: string[]) => a.length === b.length && a.every((s, k) => s === b[k])
  return segs.map((a, i) => {
    if (a.length === 0) return null
    const cover = segs.find((b, j) => j !== i && isStrictPrefix(a, b))
    if (cover) return `Already covered by “${cover.join(' › ')}” — won’t be published separately.`
    if (segs.some((b, j) => j < i && equal(a, b))) return 'Duplicate — won’t be published separately.'
    return null
  })
}

/** Decode a `c` tag value into the UI's ":"-joined chain string. */
function decodeCategory(v: string): string {
  try {
    const a = JSON.parse(v)
    if (Array.isArray(a) && a.every(x => typeof x === 'string')) return a.join(':')
  } catch { /* not JSON — legacy/other-client value */ }
  return v
}

/** Read the maximal category chains from a mod event as ":"-joined strings. */
export function extractCategories(event: NostrEvent): string[] {
  return event.tags.filter(t => t[0] === 'c').map(t => decodeCategory(t[1])).filter(Boolean)
}

// ─── Mod Events (kind 31142) ─────────────────────────────────────────

export function buildModEvent(form: ModFormState): UnsignedEvent {
  const now = Math.floor(Date.now() / 1000)
  const createdAt = form.isEdit && form.previousCreatedAt
    ? form.previousCreatedAt + 1
    : now
  const publishedAt = form.publishedAt ?? now

  const tags: string[][] = [
    ['d', form.dTag],
    ['published_at', publishedAt.toString()],
    ['g', form.game],
    ['title', form.title],
    ['image', form.featuredImageUrl],
    ['summary', form.summary],
    ['repost', form.isRepost ? 'true' : 'false', ...(form.isRepost && form.originalAuthor ? [form.originalAuthor] : [])],
  ]

  // Emulation (optional): this mod targets an emulated version of the game.
  if (form.emulation) tags.push(['emulation', 'true', form.emulatedPlatform.trim()])

  // For another mod (optional): name, naddr, or link.
  if (form.forModEnabled && form.forMod.trim()) tags.push(['m', form.forMod.trim()])

  // Dependencies (optional): one tag per item — ['dependencies', title, value].
  if (form.dependenciesEnabled) {
    for (const dep of form.dependencies) {
      const title = dep.title.trim()
      const value = dep.value.trim()
      if (title || value) tags.push(['dependencies', title, value])
    }
  }

  // Video (optional)
  if (form.featuredVideoUrl.trim()) tags.push(['video', form.featuredVideoUrl])

  // Content warning (omit tag if not NSFW)
  if (form.contentWarning) tags.push(['content-warning', form.contentWarningReason || 'nsfw'])

  // Screenshots (multi-value tag)
  const validScreenshots = form.screenshots.filter(s => s.trim())
  if (validScreenshots.length > 0) tags.push(['screenshots', ...validScreenshots])

  // Tags
  for (const t of form.tags.filter(t => t.trim())) {
    tags.push(['t', t.toLowerCase()])
  }

  // Downloads (key:value format per spec)
  for (const dl of form.downloads.filter(d => d.file.trim())) {
    tags.push(buildDownloadTag(dl))
  }

  // Permissions (only if any differ from defaults)
  tags.push(buildPermissionsTag(form.permissions))

  // Notes
  if (form.notes.trim()) tags.push(['notes', form.notes])

  // Credits
  if (form.credits.trim()) tags.push(['credits', form.credits])

  // Categories (c = maximal chains, h = rooted prefixes, f = segments)
  tags.push(...buildCategoryTags(form.categories))

  // Client (NIP-89)
  tags.push(['client', CLIENT_NAME])

  return { kind: KINDS.MOD, content: form.content, tags, created_at: createdAt, pubkey: '' }
}

// A download is one `download` tag whose single value is a JSON object. This
// keeps nested data (the scans list) clean — Nostr tags are flat string arrays,
// so structured data is JSON-encoded into one element.
function buildDownloadTag(dl: DownloadEntry): string[] {
  const obj: Record<string, unknown> = { file: dl.file }
  if (dl.title) obj.title = dl.title
  if (dl.hash) obj.hash = dl.hash
  if (dl.filename) obj.filename = dl.filename
  if (dl.version) obj.version = dl.version
  if (dl.note) obj.note = dl.note
  if (dl.image) obj.image = dl.image
  const scans = (dl.scans ?? []).filter((s) => s.label.trim() && s.url.trim())
  if (scans.length) obj.scans = scans.map((s) => ({ label: s.label.trim(), url: s.url.trim() }))
  return ['download', JSON.stringify(obj)]
}

function buildPermissionsTag(p: PermissionsData): string[] {
  return [
    'permissions',
    `original-assets:${p.originalAssets}`,
    `reupload:${p.reupload}`,
    `modification:${p.modification}`,
    `conversion:${p.conversion}`,
    `asset-usage:${p.assetUsage}`,
    `commercial:${p.commercial}`,
  ]
}

// ─── Extract mod data from event ─────────────────────────────────────

import type { Event as NostrEvent } from 'nostr-tools'
import type { ModDetails, ScanReport } from '@/types/mod'
import { DEFAULT_PERMISSIONS } from '@/types/mod'

/** Parse a single JSON `download` tag value into a DownloadEntry. */
function parseDownloadJson(value: string): DownloadEntry | null {
  try {
    const o = JSON.parse(value) as Record<string, unknown>
    if (!o || typeof o.file !== 'string' || !o.file) return null
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
    const scans = Array.isArray(o.scans)
      ? (o.scans as unknown[])
          .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>) : null))
          .filter((s): s is Record<string, unknown> => !!s && typeof s.label === 'string' && typeof s.url === 'string')
          .map<ScanReport>((s) => ({ label: s.label as string, url: s.url as string }))
      : undefined
    return {
      file: o.file,
      title: str(o.title),
      hash: str(o.hash),
      filename: str(o.filename),
      version: str(o.version),
      note: str(o.note),
      image: str(o.image),
      scans: scans && scans.length ? scans : undefined,
    }
  } catch {
    return null
  }
}

/** Legacy "downloads" key:value tag → DownloadEntry (older events, pre-JSON). */
function parseLegacyDownload(tag: string[]): DownloadEntry {
  const entry: DownloadEntry = { file: '' }
  const scans: ScanReport[] = []
  for (let i = 1; i < tag.length; i++) {
    const idx = tag[i].indexOf(':')
    if (idx === -1) continue
    const key = tag[i].slice(0, idx)
    const value = tag[i].slice(idx + 1)
    switch (key) {
      case 'file': entry.file = value; break
      case 'title': entry.title = value; break
      case 'hash': entry.hash = value; break
      case 'version': entry.version = value; break
      case 'note': entry.note = value; break
      case 'image': entry.image = value; break
      case 'malware-report': if (value) scans.push({ label: 'Report', url: value }); break
    }
  }
  if (scans.length) entry.scans = scans
  return entry
}

function parseDownloads(event: NostrEvent): DownloadEntry[] {
  const json = event.tags.filter(t => t[0] === 'download' && t[1])
  if (json.length) {
    return json.map(t => parseDownloadJson(t[1])).filter((d): d is DownloadEntry => !!d)
  }
  // Backward compatibility with the old flat "downloads" tag.
  return event.tags.filter(t => t[0] === 'downloads').map(parseLegacyDownload).filter(d => d.file)
}

export function extractModData(event: NostrEvent): ModDetails {
  cacheEvent(event)
  const getTag = (name: string) => event.tags.find(t => t[0] === name)?.[1] ?? ''
  const getTags = (name: string) => event.tags.filter(t => t[0] === name).map(t => t[1])

  const downloads: DownloadEntry[] = parseDownloads(event)

  // Parse permissions
  const permTag = event.tags.find(t => t[0] === 'permissions')
  const permissions = { ...DEFAULT_PERMISSIONS }
  if (permTag) {
    for (let i = 1; i < permTag.length; i++) {
      const colonIdx = permTag[i].indexOf(':')
      if (colonIdx === -1) continue
      const key = permTag[i].slice(0, colonIdx)
      const value = permTag[i].slice(colonIdx + 1) === 'true'
      switch (key) {
        case 'original-assets': permissions.originalAssets = value; break
        case 'reupload': permissions.reupload = value; break
        case 'modification': permissions.modification = value; break
        case 'conversion': permissions.conversion = value; break
        case 'asset-usage': permissions.assetUsage = value; break
        case 'commercial': permissions.commercial = value; break
      }
    }
  }

  // Parse screenshots
  const screenshotsTag = event.tags.find(t => t[0] === 'screenshots')
  const screenshots = screenshotsTag ? screenshotsTag.slice(1) : []

  // Parse repost
  const repostTag = event.tags.find(t => t[0] === 'repost')
  const isRepost = repostTag?.[1] === 'true'
  const originalAuthor = isRepost ? repostTag?.[2] : undefined

  // Parse emulation
  const emulationTag = event.tags.find(t => t[0] === 'emulation')
  const emulation = emulationTag?.[1] === 'true'
  const emulatedPlatform = emulation ? (emulationTag?.[2] || '') : ''

  // Content warning (NIP-36) + legacy nsfw tag
  const contentWarning = getTag('content-warning') ||
    (event.tags.find(t => t[0] === 'nsfw' && t[1] === 'true') ? 'nsfw' : undefined)

  // Deleted check
  const isDeleted = event.tags.some(t => t[0] === 'deleted' && t[1] === 'true')

  const dTag = getTag('d')

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: getTag('title'),
    summary: getTag('summary'),
    content: event.content,
    game: getTag('g'),
    publishedAt: parseInt(getTag('published_at')) || event.created_at,
    createdAt: event.created_at,
    featuredImageUrl: getTag('image') || undefined,
    featuredVideoUrl: getTag('video') || undefined,
    contentWarning: contentWarning || undefined,
    isRepost,
    originalAuthor,
    emulation,
    emulatedPlatform,
    forMod: getTag('m') || undefined,
    dependencies: event.tags
      .filter(t => t[0] === 'dependencies')
      .map(t => ({ title: t[1] || '', value: t[2] || '' }))
      .filter(d => d.title || d.value),
    screenshots,
    tags: getTags('t'),
    downloads,
    permissions,
    notes: getTag('notes') || undefined,
    credits: getTag('credits') || undefined,
    categories: extractCategories(event),
    client: getTag('client') || undefined,
    isDeleted,
    aTag: `${KINDS.MOD}:${event.pubkey}:${dTag}`,
  }
}

// ─── Deduplicate mod list by d-tag ───────────────────────────────────

export function constructModListFromEvents(events: NostrEvent[]): ModDetails[] {
  const byDTag = new Map<string, NostrEvent>()
  for (const event of events) {
    const dTag = event.tags.find(t => t[0] === 'd')?.[1] ?? ''
    const key = `${event.pubkey}:${dTag}`
    const existing = byDTag.get(key)
    if (!existing || event.created_at > existing.created_at) {
      byDTag.set(key, event)
    }
  }
  return Array.from(byDTag.values())
    .map(extractModData)
    .filter(m => !m.isDeleted)
    .sort((a, b) => b.publishedAt - a.publishedAt)
}

// ─── Check if event data is complete ─────────────────────────────────

export function isModDataComplete(event: NostrEvent): boolean {
  const has = (name: string) => event.tags.some(t => t[0] === name && t[1])
  return has('d') && has('title') && has('summary') && has('g') && has('image') &&
    event.tags.some(t => t[0] === 'screenshots' && t.length > 1) &&
    event.tags.some(t => t[0] === 't' && t[1]) &&
    event.tags.some(t => (t[0] === 'download' || t[0] === 'downloads') && t[1]) &&
    event.content.trim() !== ''
}

// ─── Blog Events (kind 30023) ────────────────────────────────────────

export function buildBlogEvent(form: BlogFormState): UnsignedEvent {
  const now = Math.floor(Date.now() / 1000)
  const createdAt = form.isEdit && form.previousCreatedAt
    ? form.previousCreatedAt + 1
    : now
  const publishedAt = form.publishedAt ?? now

  const tags: string[][] = [
    ['d', form.dTag],
    ['title', form.title],
    ['summary', form.summary],
    ['published_at', publishedAt.toString()],
  ]
  if (form.featuredImageUrl.trim()) tags.push(['image', form.featuredImageUrl])
  for (const t of form.tags.filter(t => t.trim())) {
    tags.push(['t', t.toLowerCase()])
  }
  tags.push(['client', CLIENT_NAME])

  return { kind: KINDS.BLOG, content: form.content, tags, created_at: createdAt, pubkey: '' }
}

// ─── Extract blog data from event ────────────────────────────────────

import type { BlogDetails } from '@/types/blog'

export function extractBlogData(event: NostrEvent): BlogDetails {
  cacheEvent(event)
  const getTag = (name: string) => event.tags.find(t => t[0] === name)?.[1] ?? ''
  const getTags = (name: string) => event.tags.filter(t => t[0] === name).map(t => t[1])
  const dTag = getTag('d')

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: getTag('title'),
    summary: getTag('summary'),
    content: event.content,
    publishedAt: parseInt(getTag('published_at')) || event.created_at,
    createdAt: event.created_at,
    featuredImageUrl: getTag('image') || undefined,
    tags: getTags('t'),
    client: getTag('client') || undefined,
    isDeleted: event.tags.some(t => t[0] === 'deleted' && t[1] === 'true'),
    aTag: `${KINDS.BLOG}:${event.pubkey}:${dTag}`,
  }
}

// ─── Comment Events (kind 1111, NIP-22) ──────────────────────────────

export interface CommentEventParams {
  content: string
  rootEvent: { id: string; pubkey: string; kind: number; aTag?: string }
  replyTo?: { id: string; pubkey: string; kind: number; aTag?: string }
  /** Extra tags appended verbatim (e.g. a snapshot of the mod's downloads). */
  extraTags?: string[][]
}

export function buildCommentEvent(params: CommentEventParams): UnsignedEvent {
  const tags: string[][] = []

  // Root scope (uppercase tags). Addressable roots use `A`; everything else
  // (e.g. a kind-1 note) uses `E` so the whole thread shares one root scope.
  if (params.rootEvent.aTag) {
    tags.push(['A', params.rootEvent.aTag])
  } else {
    tags.push(['E', params.rootEvent.id])
  }
  tags.push(['K', params.rootEvent.kind.toString()])
  tags.push(['P', params.rootEvent.pubkey])

  // Direct parent (lowercase tags)
  if (params.replyTo) {
    if (params.replyTo.aTag) {
      tags.push(['a', params.replyTo.aTag])
    } else {
      tags.push(['e', params.replyTo.id])
    }
    tags.push(['k', params.replyTo.kind.toString()])
    tags.push(['p', params.replyTo.pubkey])
  } else {
    // Replying directly to root
    if (params.rootEvent.aTag) {
      tags.push(['a', params.rootEvent.aTag])
    } else {
      tags.push(['e', params.rootEvent.id])
    }
    tags.push(['k', params.rootEvent.kind.toString()])
    tags.push(['p', params.rootEvent.pubkey])
  }

  if (params.extraTags?.length) tags.push(...params.extraTags)

  return {
    kind: 1111,
    content: params.content,
    tags,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

// ─── Metadata Event (kind 0) ────────────────────────────────────────

export interface ProfileMetadata {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  banner?: string
  nip05?: string
  lud16?: string
  website?: string
  [key: string]: unknown
}

export function buildMetadataEvent(metadata: ProfileMetadata): UnsignedEvent {
  return {
    kind: KINDS.METADATA,
    content: JSON.stringify(metadata),
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

// ─── Relay List Event (kind 10002, NIP-65) ──────────────────────────

export interface RelayListEntry {
  url: string
  read: boolean
  write: boolean
}

export function buildRelayListEvent(relays: RelayListEntry[]): UnsignedEvent {
  const tags = relays.map(r => {
    if (r.read && r.write) return ['r', r.url]
    if (r.read) return ['r', r.url, 'read']
    return ['r', r.url, 'write']
  })
  return { kind: KINDS.RELAY_LIST, content: '', tags, created_at: Math.floor(Date.now() / 1000), pubkey: '' }
}

// ─── Blossom Server List Event (kind 10063) ─────────────────────────

export function buildBlossomListEvent(serverUrls: string[]): UnsignedEvent {
  const tags = serverUrls.map(url => ['server', url])
  return { kind: KINDS.BLOSSOM_LIST, content: '', tags, created_at: Math.floor(Date.now() / 1000), pubkey: '' }
}

// ─── Mute List Event (kind 10000, NIP-51) ───────────────────────────

/** Public mute list of blocked user pubkeys. */
export function buildMuteListEvent(pubkeys: string[]): UnsignedEvent {
  const tags = pubkeys.map(pk => ['p', pk])
  return { kind: KINDS.MUTE_LIST, content: '', tags, created_at: Math.floor(Date.now() / 1000), pubkey: '' }
}

// ─── Deletion: Dual Mechanism (port from DEN Chat) ─────────────────

/**
 * Step 1: Re-publish with same d-tag, created_at+1, content cleared,
 * only essential tags kept, ["deleted", "true"] appended.
 */
export function buildDeletedEvent(
  originalEvent: NostrEvent,
  essentialTagNames: string[] = ['d', 'published_at'],
): UnsignedEvent {
  const essentialTags = originalEvent.tags.filter(t => essentialTagNames.includes(t[0]))
  essentialTags.push(['deleted', 'true'])

  return {
    kind: originalEvent.kind,
    content: '',
    tags: essentialTags,
    created_at: originalEvent.created_at + 1,
    pubkey: '',
  }
}

/**
 * Step 2: Publish kind 5 deletion request with 'a' tag referencing
 * the addressable event coordinate.
 */
export function buildDeletionRequest(
  originalEvent: NostrEvent,
  reason?: string,
): UnsignedEvent {
  const dTag = originalEvent.tags.find(t => t[0] === 'd')?.[1] ?? ''
  const aTagValue = `${originalEvent.kind}:${originalEvent.pubkey}:${dTag}`

  return {
    kind: KINDS.DELETE,
    content: reason ?? '',
    tags: [['a', aTagValue]],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

/**
 * Check if an event has been soft-deleted.
 */
export function isDeleted(event: NostrEvent): boolean {
  return event.tags.some(t => t[0] === 'deleted' && t[1] === 'true')
}

// ─── Generic NIP-78 list event (kind 30078) ─────────────────────────

/**
 * Build a replaceable NIP-78 application-data event with a given `d` tag and
 * an arbitrary set of additional tags (e.g. `a` coordinates, `game` names).
 * Used for admin home-page curation: `home-featured-mods-slider`,
 * `home-featured-mods`, `home-featured-games`.
 */
export function buildNip78ListEvent(dTag: string, tags: string[][]): UnsignedEvent {
  return {
    kind: KINDS.GAME_DB, // 30078: NIP-78 application-specific data
    content: '',
    tags: [['d', dTag], ...tags],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

// ─── Site Announcement (kind 30078, d: site-announcement) ───────────

export const ANNOUNCEMENT_DTAG = 'site-announcement'

export interface AnnouncementData {
  id: string
  content: string
  link?: string
  linkLabel?: string
  severity: 'info' | 'warning'
  /** True when there's nothing meaningful to show (cleared announcement). */
  isEmpty: boolean
}

export function buildAnnouncementEvent(
  content: string,
  opts: { link?: string; linkLabel?: string; severity?: 'info' | 'warning' } = {},
): UnsignedEvent {
  const tags: string[][] = [['d', ANNOUNCEMENT_DTAG]]
  if (opts.link?.trim()) tags.push(['link', opts.link.trim()])
  if (opts.linkLabel?.trim()) tags.push(['link-label', opts.linkLabel.trim()])
  tags.push(['severity', opts.severity === 'warning' ? 'warning' : 'info'])
  return {
    kind: KINDS.GAME_DB, // 30078: NIP-78 application-specific data
    content: content.trim(),
    tags,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

export function extractAnnouncement(event: NostrEvent): AnnouncementData {
  const get = (name: string) => event.tags.find(t => t[0] === name)?.[1]?.trim() || undefined
  const content = event.content.trim()
  const link = get('link')
  return {
    id: event.id,
    content,
    link,
    linkLabel: get('link-label'),
    severity: get('severity') === 'warning' ? 'warning' : 'info',
    isEmpty: !content && !link,
  }
}

// ─── Site Ads (kind 30078, d: site-ads) ─────────────────────────────

export const ADS_DTAG = 'site-ads'

export interface AdButton { text: string; link: string }

export interface AdEntry {
  name: string
  description: string
  banner: string      // background image
  profilePic: string
  buttons: AdButton[]
}

/** Build the admin's ads list (JSON array in content). */
export function buildAdsEvent(ads: AdEntry[]): UnsignedEvent {
  return {
    kind: KINDS.GAME_DB, // 30078: NIP-78 application-specific data
    content: JSON.stringify(ads),
    tags: [['d', ADS_DTAG]],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

export function extractAds(event: NostrEvent): AdEntry[] {
  try {
    const arr = JSON.parse(event.content)
    if (!Array.isArray(arr)) return []
    return arr
      .map((a): AdEntry => ({
        name: typeof a?.name === 'string' ? a.name : '',
        description: typeof a?.description === 'string' ? a.description : '',
        banner: typeof a?.banner === 'string' ? a.banner : '',
        profilePic: typeof a?.profilePic === 'string' ? a.profilePic : '',
        buttons: Array.isArray(a?.buttons)
          ? a.buttons
              .filter((b: unknown): b is AdButton => !!b && typeof (b as AdButton).text === 'string' && typeof (b as AdButton).link === 'string')
              .map((b: AdButton) => ({ text: b.text, link: b.link }))
          : [],
      }))
      .filter(a => a.banner || a.name || a.description)
  } catch {
    return []
  }
}

// ─── FAQ (kind 30078, d: site-faq) ──────────────────────────────────

export const FAQ_DTAG = 'site-faq'

export interface FaqItem { question: string; answer: string } // answer is markdown

export function buildFaqEvent(items: FaqItem[]): UnsignedEvent {
  return {
    kind: KINDS.GAME_DB,
    content: JSON.stringify(items),
    tags: [['d', FAQ_DTAG]],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

export function extractFaq(event: NostrEvent): FaqItem[] {
  try {
    const arr = JSON.parse(event.content)
    if (!Array.isArray(arr)) return []
    return arr
      .map((i): FaqItem => ({
        question: typeof i?.question === 'string' ? i.question : '',
        answer: typeof i?.answer === 'string' ? i.answer : '',
      }))
      .filter(i => i.question.trim() && i.answer.trim())
  } catch {
    return []
  }
}

// ─── Terms of Use (kind 30078, d: terms-of-use) ─────────────────────

export const TOS_DTAG = 'terms-of-use'

export interface TosItem { title: string; body: string } // body is markdown

export function buildTosEvent(items: TosItem[]): UnsignedEvent {
  return {
    kind: KINDS.GAME_DB,
    content: JSON.stringify(items),
    tags: [['d', TOS_DTAG]],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

export function extractTos(event: NostrEvent): TosItem[] {
  try {
    const arr = JSON.parse(event.content)
    if (!Array.isArray(arr)) return []
    return arr
      .map((i): TosItem => ({
        title: typeof i?.title === 'string' ? i.title : '',
        body: typeof i?.body === 'string' ? i.body : '',
      }))
      .filter(i => i.title.trim() && i.body.trim())
  } catch {
    return []
  }
}

// ─── Guides (kind 30078 list of kind:30023 article coords; d: site-guides) ──
// The guide *content* lives in long-form (kind 30023) articles; this NIP-78
// event just curates which ones (and in what order) appear as guides.

export const GUIDES_DTAG = 'site-guides'

export function buildGuidesEvent(coordinates: string[]): UnsignedEvent {
  return {
    kind: KINDS.GAME_DB,
    content: JSON.stringify(coordinates),
    tags: [['d', GUIDES_DTAG]],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

export function extractGuideCoordinates(event: NostrEvent): string[] {
  try {
    const arr = JSON.parse(event.content)
    return Array.isArray(arr) ? arr.filter((c): c is string => typeof c === 'string') : []
  } catch {
    return []
  }
}

// ─── Reports (kind 1984, NIP-56) ────────────────────────────────────

export type ReportType = 'nsfw' | 'malware' | 'illegal' | 'spam' | 'impersonation' | 'other'

export interface ReportParams {
  type: ReportType
  comment?: string
  /** The author/person involved (always set). */
  pubkey: string
  /** Reported event id (for content reports). */
  eventId?: string
  /** Addressable coordinate "kind:pubkey:dTag" (for mods/blogs). */
  coord?: string
  /** Kind of the reported post (for relay-level filtering). */
  kind?: number
  /** Blossom blob hashes (malware reports) → x tags. */
  malwareHashes?: string[]
}

export function buildReportEvent(p: ReportParams): UnsignedEvent {
  const tags: string[][] = []
  // NIP-56: report type goes on the primary tag (e for content, p for a person).
  if (p.eventId) {
    tags.push(['e', p.eventId, p.type])
    if (p.coord) tags.push(['a', p.coord])
    tags.push(['p', p.pubkey])
  } else {
    tags.push(['p', p.pubkey, p.type])
  }
  if (p.kind != null) tags.push(['k', String(p.kind)])
  for (const h of p.malwareHashes ?? []) if (h.trim()) tags.push(['x', h.trim()])
  // Client tags so moderators can filter reports at the relay level.
  tags.push(['client', CLIENT_NAME])
  tags.push(['c', CLIENT_NAME])
  return {
    kind: KINDS.REPORT,
    content: p.comment?.trim() ?? '',
    tags,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: '',
  }
}

// ─── Emulated platform suggestions (kind 30078, d: emulated-platforms) ──

export const EMULATED_PLATFORMS_DTAG = 'emulated-platforms'

export function extractEmulatedPlatforms(event: NostrEvent): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of event.tags) {
    if (t[0] === 'platform' && t[1]?.trim() && !seen.has(t[1].trim())) {
      seen.add(t[1].trim())
      out.push(t[1].trim())
    }
  }
  return out
}

// ─── Tag & category suggestions (kind 30078, NIP-78) ────────────────
// Admin-published suggestions offered (but not enforced) on the submit page.

export const SUGGESTED_TAGS_DTAG = 'suggested-tags'
export const SUGGESTED_CATEGORIES_DTAG = 'suggested-categories'

/** Suggested t-tags (one per `t` tag). */
export function extractSuggestedTags(event: NostrEvent): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of event.tags) {
    const v = t[0] === 't' ? t[1]?.trim() : ''
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v) }
  }
  return out
}

/** Suggested category chains, stored as `c` JSON-array tags (same as mods). */
export function buildSuggestedCategoriesEvent(chains: string[]): UnsignedEvent {
  const seen = new Set<string>()
  const tags: string[][] = []
  for (const raw of chains) {
    const segs = normalizeChain(raw)
    if (!segs.length) continue
    const json = JSON.stringify(segs)
    if (seen.has(json)) continue
    seen.add(json)
    tags.push(['c', json])
  }
  return buildNip78ListEvent(SUGGESTED_CATEGORIES_DTAG, tags)
}

/** Suggested category chains as ":"-joined strings (reuses the mod decoder). */
export const extractSuggestedCategories = extractCategories

// ─── Game DB Event (kind 30078, NIP-78) ──────────────────────────────

export function buildGameDbEvent(
  dTag: string,
  csvFiles: { hash: string; title?: string }[],
): UnsignedEvent {
  const tags: string[][] = [
    ['d', dTag],
    ...csvFiles.map(f => f.title ? ['csv', f.hash, f.title] : ['csv', f.hash]),
  ]
  return { kind: KINDS.GAME_DB, content: '', tags, created_at: Math.floor(Date.now() / 1000), pubkey: '' }
}
