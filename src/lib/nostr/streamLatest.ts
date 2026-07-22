import type { Event as NostrEvent, Filter } from 'nostr-tools'
import { subscribe } from './relay-pool'

/**
 * How long a cold view keeps listening after the first relay answers, so a
 * newer revision on a slower relay still surfaces. Only bounds the *watching* —
 * the page has already rendered.
 */
export const COLD_WATCH_MS = 6000

/**
 * Grace period in which a newer revision replaces what's on screen silently
 * instead of prompting. Nothing has been read this soon after opening, so the
 * swap is invisible where the dialog would be an interruption.
 */
export const SILENT_UPGRADE_MS = 2500

export interface StreamLatestOptions {
  /** An event already on screen (e.g. resolved by a short address), if any. */
  have?: NostrEvent | null
  /** Render this event now — first arrival, or a silent in-grace upgrade. */
  onApply: (event: NostrEvent) => void
  /** A newer revision arrived after the grace window: prompt, don't force. */
  onNewer: (event: NostrEvent) => void
  /** No relay held the event and nothing was already on screen. */
  onEmpty?: () => void
  /**
   * Watching started/stopped, for a "checking for updates" indicator. Called at
   * most once with true and once with false, so it pairs cleanly with a
   * ref-counted signal like beginRefresh/endRefresh.
   */
  onWatching?: (active: boolean) => void
  watchMs?: number
  silentUpgradeMs?: number
}

/**
 * Cold-view load of an addressable event: show the first relay to answer, then
 * keep listening for a newer revision until the watch window closes.
 *
 * The alternative — waiting for every relay to EOSE before rendering — means one
 * slow or dead relay holds the whole page at a spinner. That is also exactly the
 * case a shared link lands in, where the reader has no cache and no patience.
 *
 * Relays can hold different revisions of the same coordinate, so first-to-answer
 * is not necessarily newest; that's what the watch is for. A revision arriving
 * inside the grace window is swapped in silently, because a modal over a page
 * you opened two seconds ago is worse than the swap it would warn about. After
 * that it prompts, so nothing is pulled out from under someone mid-read.
 *
 * `stop()` is required on unmount: it closes the subscription and releases the
 * watching signal, which would otherwise stay up for the rest of the session.
 */
export function streamLatestEvent(
  relayUrls: string[],
  filter: Filter,
  opts: StreamLatestOptions,
): { done: Promise<void>; stop: () => void } {
  const {
    have = null,
    onApply,
    onNewer,
    onEmpty,
    onWatching,
    watchMs = COLD_WATCH_MS,
    silentUpgradeMs = SILENT_UPGRADE_MS,
  } = opts

  let stop = () => {}
  const done = new Promise<void>((resolve) => {
    let best: NostrEvent | null = have
    let finished = false
    let indicating = false
    const openedAt = Date.now()

    // `teardown` means the caller unmounted rather than the watch ending on its
    // own. Reporting "not found" then would set state on a page nobody is
    // looking at, and would do it for the common case of navigating away early.
    const finish = (teardown = false) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try { sub.close() } catch { /* already closed */ }
      if (indicating) { indicating = false; onWatching?.(false) }
      // Nothing anywhere, and nothing was already on screen.
      if (!best && !teardown) onEmpty?.()
      resolve()
    }
    stop = () => finish(true)

    const timer = setTimeout(() => finish(), watchMs)
    const sub = subscribe(relayUrls, filter, (ev) => {
      if (finished) return
      if (best && ev.created_at <= best.created_at) return // older or same
      const first = !best
      best = ev
      if (first || Date.now() - openedAt < silentUpgradeMs) onApply(ev)
      else onNewer(ev)
      // Say so while slower relays are still being heard: what's on screen came
      // from whoever answered first and may yet be superseded.
      if (first && !indicating) { indicating = true; onWatching?.(true) }
      // Wrapped, not passed by reference: an EOSE callback invoked with any
      // argument would read as `teardown` and silently suppress onEmpty.
    }, () => finish())
  })

  return { done, stop }
}
