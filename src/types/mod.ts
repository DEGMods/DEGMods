/**
 * Types for Game Mod Events (Kind 31142)
 * See docs/game-mod-event.md for full spec
 */

// ─── Download entry (key:value format) ──────────────────────────────

/** A malware-scan report link: a provider label + an explicit report URL. */
export interface ScanReport {
  label: string
  url: string
}

export interface DownloadEntry {
  file: string           // required: download URL
  title?: string
  hash?: string          // SHA-256
  filename?: string      // original uploaded filename, restored on download
  scans?: ScanReport[]   // malware-scan report links
  version?: string
  note?: string
  image?: string         // preview image URL
}

// ─── Permissions ────────────────────────────────────────────────────

export interface PermissionsData {
  originalAssets: boolean  // default true
  reupload: boolean        // default true
  modification: boolean    // default true
  conversion: boolean      // default true
  assetUsage: boolean      // default true
  commercial: boolean      // default false
}

export const DEFAULT_PERMISSIONS: PermissionsData = {
  originalAssets: true,
  reupload: true,
  modification: true,
  conversion: true,
  assetUsage: true,
  commercial: false,
}

// ─── Parsed mod data from event ─────────────────────────────────────

export interface ModDetails {
  id: string             // event id
  pubkey: string         // author pubkey
  dTag: string           // UUID v4 identifier
  title: string
  summary: string
  content: string        // markdown body
  game: string           // game name
  publishedAt: number    // unix timestamp (never changes on edit)
  createdAt: number      // unix timestamp (increments on edit)
  featuredImageUrl?: string
  featuredVideoUrl?: string
  contentWarning?: string // presence = NSFW
  isRepost: boolean
  originalAuthor?: string // npub or link (when repost=true)
  emulation: boolean      // mod targets an emulated version of the game
  emulatedPlatform?: string // platform the game is emulated from (e.g. "Xbox 360")
  forMod?: string         // m tag: this mod is for another mod (name, naddr, or link)
  jamCoordinate?: string  // a tag (31143:…) when this mod is a jam entry (l=jam-entry)
  dependencies: Dependency[] // dependencies tags (other mods/software/files)
  screenshots: string[]  // image URLs
  tags: string[]         // t tags
  downloads: DownloadEntry[]
  permissions: PermissionsData
  notes?: string         // publisher notes
  credits?: string       // attribution
  categories: string[]   // c tags (parent:child format)
  client?: string        // NIP-89 client tag (publishing app name)
  isDeleted: boolean
  aTag: string           // addressable coordinate: 31142:<pubkey>:<d-tag>
  legacy?: boolean       // LEGACY: true for old kind-30402 "GameMod" mods
  legacyMigrated?: boolean // LEGACY: legacy post carries ["legacy","yes"] (migrated)
}

/** A dependency: a name/title paired with a ref (mod name, naddr, or link). */
export interface Dependency {
  title: string
  value: string
}

// ─── Form state for mod editor ──────────────────────────────────────

export interface ModFormState {
  dTag: string
  title: string
  summary: string
  content: string
  game: string
  featuredImageUrl: string
  featuredVideoUrl: string
  contentWarning: boolean
  contentWarningReason: string
  isRepost: boolean
  originalAuthor: string
  emulation: boolean
  emulatedPlatform: string
  forModEnabled: boolean
  forMod: string
  jamEnabled: boolean
  jamNaddr: string
  dependenciesEnabled: boolean
  dependencies: Dependency[]
  screenshots: string[]
  tags: string[]
  downloads: DownloadEntry[]
  permissions: PermissionsData
  notes: string
  credits: string
  categories: string[]
  // Edit mode
  isEdit: boolean
  previousCreatedAt?: number
  publishedAt?: number
}

// ─── Form validation errors ─────────────────────────────────────────

export interface FormErrors {
  title?: string
  summary?: string
  content?: string
  game?: string
  featuredImageUrl?: string
  screenshots?: string
  tags?: string
  downloads?: string
  originalAuthor?: string
  general?: string
}

// ─── Validation ─────────────────────────────────────────────────────

export function validateModForm(form: ModFormState): FormErrors {
  const errors: FormErrors = {}
  if (!form.title.trim()) errors.title = 'Title is required'
  if (!form.summary.trim()) errors.summary = 'Summary is required'
  if (!form.content.trim()) errors.content = 'Body content is required'
  if (!form.game.trim()) errors.game = 'Game is required'
  if (!form.featuredImageUrl.trim()) errors.featuredImageUrl = 'Featured image is required'
  if (form.screenshots.filter(s => s.trim()).length === 0) errors.screenshots = 'At least one screenshot is required'
  if (form.tags.filter(t => t.trim()).length === 0) errors.tags = 'At least one tag is required'
  if (form.downloads.filter(d => d.file.trim()).length === 0) errors.downloads = 'At least one download is required'
  if (form.isRepost && !form.originalAuthor.trim()) errors.originalAuthor = 'Original author is required for reposts'
  return errors
}

export function hasErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0
}

export function createEmptyFormState(): ModFormState {
  return {
    dTag: crypto.randomUUID(),
    title: '',
    summary: '',
    content: '',
    game: '',
    featuredImageUrl: '',
    featuredVideoUrl: '',
    contentWarning: false,
    contentWarningReason: 'nsfw',
    isRepost: false,
    originalAuthor: '',
    emulation: false,
    emulatedPlatform: '',
    forModEnabled: false,
    forMod: '',
    jamEnabled: false,
    jamNaddr: '',
    dependenciesEnabled: false,
    dependencies: [{ title: '', value: '' }],
    screenshots: [''],
    tags: [''],
    downloads: [{ file: '' }],
    permissions: { ...DEFAULT_PERMISSIONS },
    notes: '',
    credits: '',
    categories: [],
    isEdit: false,
  }
}
