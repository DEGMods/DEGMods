/**
 * Publish pipeline: PoW mine → sign → publish to relays
 *
 * All event types go through this pipeline: mods, blogs, comments,
 * reactions, edits, and deletion events.
 */

import type { UnsignedEvent, Event as NostrEvent } from 'nostr-tools'
import { publishEvent } from './relay-pool'
import { signEvent, useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { mineEvent } from '@/lib/pow/pow'
import { computeShortCode, SHORT_KINDS } from './nipShort'

// ─── Types ──────────────────────────────────────────────────────────

export type PublishStatus = 'mining' | 'signing' | 'publishing' | 'done' | 'error'

export interface PublishResult {
  success: boolean
  event?: NostrEvent
  error?: string
}

// ─── Sign and Publish ───────────────────────────────────────────────

/**
 * Full pipeline: PoW (if difficulty > 0) → sign → publish to all write relays.
 *
 * @param unsignedEvent - The event to publish (pubkey can be empty, signer fills it)
 * @param onStatus - Optional callback for status updates
 * @param publishTimeoutMs - Timeout for publishing to relays (default 10s)
 * @param extraRelays - Additional relays to publish to, unioned with the write relays
 *                      (e.g. a mod jam's declared ballot/result relays)
 */
export async function signAndPublish(
  unsignedEvent: UnsignedEvent,
  onStatus?: (status: PublishStatus) => void,
  publishTimeoutMs: number = 10000,
  extraRelays: string[] = [],
): Promise<PublishResult> {
  const settings = useSettingsStore.getState()
  const difficulty = settings.powDifficulty
  const writeRelays = [...new Set([...settings.getAllEnabledRelayUrls('write'), ...extraRelays])]

  if (writeRelays.length === 0) {
    return { success: false, error: 'No write relays configured' }
  }

  try {
    let eventToSign = unsignedEvent

    // Step 0: NIP-SHORT code. Added before mining, which is safe because mining
    // only rewrites the nonce tag — the fields the code derives from (kind,
    // pubkey, created_at, content) survive it. Doing it after would invalidate
    // the proof of work, since the tag is part of what's hashed.
    if (SHORT_KINDS.has(eventToSign.kind) && !eventToSign.tags.some((t) => t[0] === 's')) {
      const pubkey = useAuthStore.getState().pubkey
      if (pubkey) {
        const code = computeShortCode({ ...eventToSign, pubkey })
        eventToSign = { ...eventToSign, tags: [...eventToSign.tags, ['s', code]] }
      }
    }

    // Step 1: PoW (if difficulty > 0). Mine against the logged-in pubkey — don't
    // ask the signer (its active account may differ from the one we logged in with).
    if (difficulty > 0) {
      onStatus?.('mining')
      const pubkey = useAuthStore.getState().pubkey
      if (pubkey) {
        eventToSign = await mineEvent(eventToSign, difficulty, pubkey)
      }
    }

    // Step 2: Sign
    onStatus?.('signing')
    const signedEvent = await signEvent(eventToSign as unknown as Record<string, unknown>) as unknown as NostrEvent

    // Step 3: Publish to all write relays
    onStatus?.('publishing')
    await Promise.race([
      publishEvent(signedEvent, writeRelays),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Publish timed out')), publishTimeoutMs)
      ),
    ])

    onStatus?.('done')
    return { success: true, event: signedEvent }
  } catch (err) {
    onStatus?.('error')
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ─── Publish with per-relay status ──────────────────────────────────

export interface RelayPublishStatus {
  url: string
  status: 'pending' | 'success' | 'error'
  error?: string
}

export async function publishWithStatus(
  event: NostrEvent,
  relayUrls: string[],
  onStatus?: (statuses: RelayPublishStatus[]) => void,
): Promise<RelayPublishStatus[]> {
  const statuses: RelayPublishStatus[] = relayUrls.map(url => ({
    url,
    status: 'pending' as const,
  }))

  onStatus?.(statuses)

  const { getPool } = await import('./relay-pool')
  const pool = getPool()

  await Promise.allSettled(
    pool.publish(relayUrls, event).map(async (promise, i) => {
      try {
        await promise
        statuses[i] = { ...statuses[i], status: 'success' }
      } catch (err) {
        statuses[i] = {
          ...statuses[i],
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed',
        }
      }
      onStatus?.([...statuses])
    })
  )

  return statuses
}

// ─── Request Delete (dual mechanism) ────────────────────────────────

import { buildDeletedEvent, buildDeletionRequest } from './events'

/** The two phases of a delete request, for progress reporting. */
export type DeleteStep = 'edit' | 'request'

/**
 * Dual-mechanism deletion (best-effort; relays/clients that honor it will drop
 * the event; copies may persist on relays that don't):
 * 1. Publish a tombstoned ("deleted") version of the event (relay replaces original)
 * 2. Publish a kind 5 deletion request (asks relays to purge)
 *
 * Both go through the PoW pipeline. `onProgress(step, phase)` reports the
 * mining/signing/publishing phase of each step.
 *
 * Unlike every other publish, deletion deliberately ignores the "max 3 relays
 * per list" posting preference and goes everywhere it can reach. That cap
 * exists to spread publishing load, which is a reasonable trade for a new post
 * — a missed relay just doesn't have it. Retraction is the opposite: a missed
 * relay keeps serving the post forever, and this client actively works against
 * itself there, since eventRedundancy has readers re-broadcast copies to relays
 * that lack them.
 *
 * The relay set is resolved ONCE and reused for both steps. Resolving it twice
 * re-ran the random per-list pick, so the tombstone and the deletion request
 * could land on different subsets — leaving relays holding the original with a
 * purge request they may ignore, or a purge request for something they were
 * never given the tombstone for.
 *
 * `both`, not `write`: a relay we only read from can still hold a copy, and it
 * is the copy that matters here. A write rejected by a read-only relay costs
 * nothing.
 */
export async function requestDelete(
  originalEvent: NostrEvent,
  onProgress?: (step: DeleteStep, phase: PublishStatus) => void,
  opts: { requestOnly?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
  const everywhere = useSettingsStore.getState().getAllEnabledRelayUrls('both')

  // Step 1: tombstoned version. Carries created_at + 1, so a relay that takes
  // it will also refuse the pre-delete copy if a re-broadcast offers it later.
  // This is the only mechanism that works on relays which ignore kind 5, so it
  // gets the widest reach we can give it.
  //
  // Skipped for regular (non-addressable) events like comments and notes: there
  // is nothing to replace, so the kind-5 request is the only lever.
  const deletedResult = opts.requestOnly
    ? { success: true, error: undefined as string | undefined }
    : await signAndPublish(buildDeletedEvent(originalEvent), (s) => onProgress?.('edit', s), 10000, everywhere)
  if (!deletedResult.success) onProgress?.('edit', 'error')

  // Step 2: kind 5 deletion request — attempted even if step 1 failed. It's the
  // stronger signal on relays that honour it, and skipping it because the edit
  // failed only loses ground: there is no state in which sending it is worse.
  const deletionRequest = buildDeletionRequest(originalEvent)
  const deletionResult = await signAndPublish(deletionRequest, (s) => onProgress?.('request', s), 10000, everywhere)
  if (!deletionResult.success) onProgress?.('request', 'error')

  if (deletedResult.success && deletionResult.success) return { success: true }
  // Report what actually failed rather than the first failure, so a partial
  // deletion isn't described as if nothing happened.
  const failures = [
    !deletedResult.success && `tombstone (${deletedResult.error})`,
    !deletionResult.success && `deletion request (${deletionResult.error})`,
  ].filter(Boolean)
  return { success: false, error: `Failed to publish ${failures.join(' and ')}` }
}
