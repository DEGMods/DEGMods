/**
 * LEGACY MOD SUPPORT — kind 30402 (NIP-99 "Classified", tag t=GameMod)
 * ─────────────────────────────────────────────────────────────────────────
 * DEG Mods migrated to a dedicated mod event (kind 31142). This module renders
 * the OLD mod events so historical posts stay viewable. It is intentionally
 * self-contained: to sunset legacy support later, delete this file + the store
 * `legacyModsStore.ts`, then `grep -r "LEGACY"` and remove the marked blocks.
 */
import type { Event as NostrEvent } from 'nostr-tools'
import type { ModDetails, ModFormState, DownloadEntry, PermissionsData } from '@/types/mod'

export const LEGACY_MOD_KIND = 30402
export const LEGACY_GAMEMOD_TAG = 'GameMod'

/**
 * Legacy events published on or after this instant are ignored. Freezes the
 * legacy set at the migration date so no new kind-30402 "GameMod" events can be
 * injected and rendered as legacy mods afterwards.
 */
export const LEGACY_CUTOFF = Math.floor(Date.parse('2026-08-01T00:00:00Z') / 1000)

/** True if the event is a DEG Mods legacy mod within the accepted date window. */
export function isLegacyModEvent(event: NostrEvent): boolean {
  return (
    event.kind === LEGACY_MOD_KIND &&
    event.created_at < LEGACY_CUTOFF &&
    event.tags.some((t) => t[0] === 't' && t[1] === LEGACY_GAMEMOD_TAG)
  )
}

/** Merge legacy mods into a list and re-sort by publish date (newest first). */
export function withLegacyMods(mods: ModDetails[], legacy: ModDetails[]): ModDetails[] {
  if (legacy.length === 0) return mods
  return [...mods, ...legacy].sort((a, b) => b.publishedAt - a.publishedAt)
}

interface LegacyDownloadUrl {
  url?: string
  title?: string
  hash?: string
  malwareScanLink?: string
  modVersion?: string
  customNote?: string
  mediaUrl?: string
}

function boolTag(event: NostrEvent, name: string, dflt: boolean): boolean {
  const v = event.tags.find((t) => t[0] === name)?.[1]
  return v === undefined ? dflt : v === 'true'
}

/** Parse a legacy (kind-30402) mod event into the shared ModDetails shape. */
export function extractLegacyModData(event: NostrEvent): ModDetails {
  const first = (name: string): string => event.tags.find((t) => t[0] === name)?.[1] ?? ''
  // All values across every tag of a name (handles both one-per-tag and
  // multi-value-per-tag encodings the old client used).
  const allValues = (name: string): string[] =>
    event.tags.filter((t) => t[0] === name).flatMap((t) => t.slice(1)).filter(Boolean)

  const dTag = first('d')

  const downloads: DownloadEntry[] = allValues('downloadUrls')
    .map((raw): DownloadEntry | null => {
      try {
        const d = JSON.parse(raw) as LegacyDownloadUrl
        if (!d.url) return null
        const entry: DownloadEntry = { file: d.url }
        if (d.title) entry.title = d.title
        if (d.hash) entry.hash = d.hash
        if (d.modVersion) entry.version = d.modVersion
        if (d.customNote) entry.note = d.customNote
        if (d.mediaUrl) entry.image = d.mediaUrl
        if (d.malwareScanLink) entry.scans = [{ label: 'Malware scan', url: d.malwareScanLink }]
        return entry
      } catch {
        return null
      }
    })
    .filter((d): d is DownloadEntry => d !== null)

  const permissions: PermissionsData = {
    originalAssets: boolTag(event, 'otherAssets', true),
    reupload: boolTag(event, 'uploadPermission', true),
    modification: boolTag(event, 'modPermission', true),
    conversion: boolTag(event, 'convPermission', true),
    assetUsage: boolTag(event, 'assetUsePermission', true),
    commercial: boolTag(event, 'assetUseComPermission', false),
  }

  const publishedAt = parseInt(first('published_at'), 10)

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: first('title'),
    summary: first('summary'),
    content: event.content,
    game: first('game'),
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : event.created_at,
    createdAt: event.created_at,
    featuredImageUrl: first('featuredImageUrl') || undefined,
    featuredVideoUrl: undefined,
    contentWarning: first('nsfw') === 'true' ? 'NSFW' : undefined,
    isRepost: first('repost') === 'true',
    originalAuthor: first('originalAuthor') || undefined,
    emulation: false,
    emulatedPlatform: undefined,
    forMod: undefined,
    dependencies: [],
    screenshots: allValues('screenshotsUrls'),
    tags: allValues('tags'),
    downloads,
    permissions,
    notes: first('publisherNotes') || undefined,
    credits: first('extraCredits') || undefined,
    categories: [], // legacy category scheme intentionally not shown
    client: undefined,
    isDeleted: false,
    aTag: `${LEGACY_MOD_KIND}:${event.pubkey}:${dTag}`,
    legacy: true,
    legacyMigrated: event.tags.some((t) => t[0] === 'legacy' && t[1] === 'yes'),
  }
}

/**
 * Build a current-format (kind-31142) mod form from a legacy mod, for migration.
 * Keeps the same d-tag and transfers everything except categories (a different
 * scheme) and legacy-only concepts (no emulation/dependencies/forMod exist).
 */
export function legacyToForm(mod: ModDetails): ModFormState {
  return {
    dTag: mod.dTag, // same d-tag so the migrated post shares the coordinate
    title: mod.title,
    summary: mod.summary,
    content: mod.content,
    game: mod.game,
    featuredImageUrl: mod.featuredImageUrl ?? '',
    featuredVideoUrl: mod.featuredVideoUrl ?? '',
    contentWarning: !!mod.contentWarning,
    contentWarningReason: mod.contentWarning || 'nsfw',
    isRepost: mod.isRepost,
    originalAuthor: mod.originalAuthor ?? '',
    emulation: false,
    emulatedPlatform: '',
    forModEnabled: false,
    forMod: '',
    dependenciesEnabled: false,
    dependencies: [],
    screenshots: mod.screenshots.length ? mod.screenshots : [''],
    tags: mod.tags.map((t) => t.trim()).filter(Boolean), // trim leading/trailing spaces
    downloads: mod.downloads.length ? mod.downloads : [{ file: '' }],
    permissions: mod.permissions,
    notes: mod.notes ?? '',
    credits: mod.credits ?? '',
    categories: [], // not migrated
    isEdit: false,
    previousCreatedAt: undefined,
    publishedAt: mod.publishedAt, // preserve the original publish date
  }
}
