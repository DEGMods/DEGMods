/**
 * Debounced writer for IndexedDB-backed caches. Coalesces bursts of changes
 * into one write, and also flushes when the tab is hidden / navigated away
 * (best-effort — async IDB writes on unload aren't guaranteed, so the periodic
 * debounced write is the real durability guarantee).
 *
 * Returns a `schedule()` to call after each change.
 */
export function createPersister(flush: () => void, delayMs = 800): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const run = () => {
    if (timer) { clearTimeout(timer); timer = null }
    flush()
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, delayMs)
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && timer) run()
    })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { if (timer) run() })
  }

  return schedule
}
