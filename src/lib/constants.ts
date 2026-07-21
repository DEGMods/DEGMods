/**
 * DEG MODS: Constants and Configuration
 */

import relaysData from './relays.json'

// ─── Storage Keys ───────────────────────────────────────────────────

// ─── Upload limits & accepted formats ───────────────────────────────

/** Hard cap for mod file uploads — separate from the user-configurable media limit, not user-editable. */
export const MOD_FILE_UPLOAD_LIMIT_MB = 500
/** Accepted image upload formats. SVG is excluded — it can carry scripts (XSS). */
export const IMAGE_UPLOAD_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.avif'
/** Accepted mod file upload formats. ZIP only — it's the one we can preview contents of (central directory). */
export const MOD_FILE_UPLOAD_ACCEPT = '.zip'

export const StorageKey = {
  CURRENT_ACCOUNT: 'deg-mods:current-account',
  AUTH_METHOD: 'deg-mods:auth-method',
  BUNKER_KEY: 'deg-mods:bunker-key',
  BUNKER_STRING: 'deg-mods:bunker-string',
  PC55_CLIENT_KEY: 'deg-mods:pc55-client-key',
  CLIENT_RELAYS: 'deg-mods:client-relays',
  CLIENT_BLOSSOMS: 'deg-mods:client-blossoms',
  USER_RELAYS: 'deg-mods:user-relays',
  USER_BLOSSOMS: 'deg-mods:user-blossoms',
  CUSTOM_RELAYS: 'deg-mods:custom-relays',
  CUSTOM_BLOSSOMS: 'deg-mods:custom-blossoms',
  DNN_NODES: 'deg-mods:dnn-nodes',
  USER_DNN_NODES: 'deg-mods:user-dnn-nodes',
  POW_DIFFICULTY: 'deg-mods:pow-difficulty',
  POW_FILTER_DIFFICULTY: 'deg-mods:pow-filter',
  HASH_RATE: 'deg-mods:hash-rate',
  BLOSSOM_UPLOAD_LIMIT_MB: 'deg-mods:blossom-upload-limit-mb',
  MEDIA_DOWNLOAD_LIMIT_MB: 'deg-mods:media-download-limit-mb',
  POSTING_BEHAVIOUR: 'deg-mods:posting-behaviour',
} as const

// ─── Encrypted (IndexedDB) store keys ───────────────────────────────

export const SECURE_KEYS = {
  UPV2_SESSION: 'upv2-session',
} as const

// ─── Admin ──────────────────────────────────────────────────────────

export const ADMIN_NPUB = 'npub17jl3ldd6305rnacvwvchx03snauqsg4nz8mruq0emj9thdpglr2sst825x'
export const ADMIN_PUBKEY = 'f4bf1fb5ba8be839f70c7331733e309f780822b311f63e01f9dc8abbb428f8d5'

// ─── Client (NIP-89) ────────────────────────────────────────────────

/** This client's name, stamped on published events via a `client` tag. */
export const CLIENT_NAME = 'DEG MODS'

// ─── Moderation (admin NIP-78) ──────────────────────────────────────

/** d-tag of the admin moderation event holding the default excluded tags. */
export const MODERATION_EXCLUDED_TAGS_DTAG = 'moderation-excluded-tags'

/** d-tag of the admin moderation event holding the blocked mods list. */
export const BLOCKED_MODS_DTAG = 'blocked-mods'

/** Fallback default excluded tags, used until the admin NIP-78 list loads. */
export const DEFAULT_EXCLUDED_TAGS = ['loli', 'shota', 'gore', 'politics', 'religion']

// ─── Categories ─────────────────────────────────────────────────────
// Hierarchical category chains are stored as JSON string-arrays across c/h/f
// tags (see docs/game-mod-event.md). These caps bound the event size.

/** Max segments (levels) in a single category chain. */
export const CATEGORY_MAX_DEPTH = 5
/** Max category chains per mod. */
export const CATEGORY_MAX_CHAINS = 10
/** Max characters per category segment. */
export const CATEGORY_SEGMENT_MAXLEN = 30

// ─── Nostr Event Kinds ──────────────────────────────────────────────

export const KINDS = {
  METADATA: 0,
  SHORT_NOTE: 1,
  CONTACTS: 3,
  DELETE: 5,
  REPORT: 1984, // NIP-56 reporting
  MUTE_LIST: 10000, // NIP-51 mute list (blocked users)
  RELAY_LIST: 10002,
  BLOSSOM_LIST: 10063,
  BLOG: 30023,
  MOD: 31142,
  JAM: 31143, // mod/game jam event
  JAM_BALLOT: 31243, // one voter's scores for one jam entry
  JAM_RESULT: 31343, // creator's published tally (paged)
  GAME_DB: 30078, // NIP-78 app-specific data (d tag: games-db)
  PAYTO: 10133, // NIP-A3 payment targets (replaceable, one per author)
  MODERATION_TAG: 30985, // addressable tag overlay applied to someone else's post
} as const

// ─── Types ──────────────────────────────────────────────────────────

export interface RelayConfig {
  url: string
  read: boolean
  write: boolean
  enabled: boolean
  /** Pre-marked as NIP-50 search capable (defaults only; user relays use the probe). */
  search?: boolean
}

export interface BlossomConfig {
  url: string
  enabled: boolean
  /** Always included in uploads/failover, exempt from the per-list random cap
   *  (e.g. the DEG Mods mod-file node, which must reliably receive every mod). */
  pinned?: boolean
}

export interface DnnNodeConfig {
  url: string
  enabled: boolean
  healthy?: boolean
  lastChecked?: number
}

// ─── Analytics ──────────────────────────────────────────────────────

/**
 * Self-hosted Umami. Cookieless and stores no personal data, but it's still a
 * request to a server on every page, so it's behind a setting users can turn off.
 *
 * The website id is carried over from the previous DEG Mods site: most routes
 * are unchanged, so keeping it preserves the history behind /ads' audience
 * figures rather than restarting from zero.
 */
export const UMAMI_SCRIPT_URL = 'https://an.degmods.com/script.js'
export const UMAMI_WEBSITE_ID = '5738aafa-e5ab-4e8a-b92b-41828ddd9c1b'

/**
 * Only report from this domain (and its subdomains).
 *
 * Umami has no domain allowlist — anything that posts a website id is counted,
 * and the id is readable in any deployed bundle. So a fork that changes its
 * domain but not these constants would file its traffic under ours, and local
 * development would do the same. This keeps that from happening by accident.
 *
 * A fork should set this to its own domain, or clear it to report from anywhere.
 * The server hosting Umami should also reject foreign origins — this guard is
 * for honest mistakes, not for anyone determined.
 */
export const UMAMI_HOST = 'degmods.com'

// ─── Defaults ───────────────────────────────────────────────────────

// Shared with the SEO sitemap script (scripts/generate-sitemap.mjs), which reads
// the same relays.json, so the two can't drift.
export const DEFAULT_RELAYS = relaysData as RelayConfig[]

export const DEFAULT_BLOSSOMS: BlossomConfig[] = [
  // DEG Mods' own mod-file node (R2-backed, .zip only). Pinned so every mod upload
  // reliably lands here; the public servers below handle media + add redundancy.
  { url: 'https://brs.degmods.com', enabled: true, pinned: true },
  { url: 'https://blossom.primal.net', enabled: true },
  { url: 'https://blossom.band', enabled: true },
  { url: 'https://nostr.hu', enabled: true },
]

export const DEFAULT_DNN_NODES: DnnNodeConfig[] = [
  { url: 'https://node.icannot.xyz', enabled: true },
]
