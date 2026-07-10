/**
 * LEGACY MOD MIGRATION — moves an old kind-30402 mod to the current kind-31142
 * format. Two steps:
 *   1. Mark the legacy post migrated by adding a ["legacy","yes"] tag (no PoW).
 *   2. Publish a new current-format mod with the SAME d-tag (default PoW), so
 *      its naddr (kind 31142 + same pubkey + same d-tag) is deterministic.
 * Remove on sunset along with lib/mods/legacy.ts.
 */
import { nip19, type Event as NostrEvent, type UnsignedEvent } from 'nostr-tools'
import type { ModDetails } from '@/types/mod'
import { buildModEvent } from '@/lib/nostr/events'
import { signAndPublish } from '@/lib/nostr/publish'
import { signEvent } from '@/stores/authStore'
import { publishEvent } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { KINDS } from '@/lib/constants'
import { legacyToForm } from './legacy'

export type MigrateStep = 'marking' | 'creating' | 'done'

/** The naddr of the migrated (current-format) post for a legacy mod. */
export function migratedNaddr(mod: ModDetails): string {
  return nip19.naddrEncode({ kind: KINDS.MOD, pubkey: mod.pubkey, identifier: mod.dTag })
}

export async function migrateLegacyMod(
  rawEvent: NostrEvent,
  mod: ModDetails,
  onStep: (step: MigrateStep) => void,
): Promise<{ naddr: string }> {
  const writeRelays = useSettingsStore.getState().getAllEnabledRelayUrls('write')
  if (writeRelays.length === 0) throw new Error('No write relays configured')

  // Step 1 — mark the legacy post as migrated (add ["legacy","yes"], keep the
  // rest). Legacy mods are PoW-exempt, so sign + publish directly.
  onStep('marking')
  const marked: UnsignedEvent = {
    kind: rawEvent.kind,
    pubkey: rawEvent.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: rawEvent.content,
    tags: [...rawEvent.tags.filter((t) => t[0] !== 'legacy'), ['legacy', 'yes']],
  }
  const signedMark = (await signEvent(marked as unknown as Record<string, unknown>)) as unknown as NostrEvent
  await publishEvent(signedMark, writeRelays)

  // Step 2 — publish the current-format mod (default PoW), same d-tag. Carry
  // over the legacy event's created_at (and published_at, via the form) for
  // fidelity: the migrated post is a NEW coordinate (kind 31142 vs 30402), so no
  // relay holds a prior version for the preserved timestamp to lose to. PoW
  // mining only varies the nonce tag, so the timestamp survives.
  onStep('creating')
  const unsigned = { ...buildModEvent(legacyToForm(mod)), created_at: mod.createdAt }
  const res = await signAndPublish(unsigned)
  if (!res.success) throw new Error(res.error || 'Failed to create the migrated mod')

  onStep('done')
  return { naddr: migratedNaddr(mod) }
}
