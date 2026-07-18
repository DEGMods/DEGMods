/**
 * Relay capability probing.
 *
 * NIP-45 (`COUNT`) is optional and thinly implemented, but a jam that tallies
 * community votes by counting depends on it — so a creator needs to know which
 * of their vote relays can actually do the job *before* the jam runs, not when
 * the tally comes up empty. The only reliable answer is to ask the relay.
 */

export type CountSupport = 'unknown' | 'checking' | 'yes' | 'no' | 'unreachable'

const cache = new Map<string, CountSupport>()
const inflight = new Map<string, Promise<CountSupport>>()

/**
 * Ask a relay for a trivial count and see whether it answers.
 *
 * A supporting relay replies `["COUNT", <id>, {count: n}]`. Anything else —
 * a NOTICE, a CLOSED, or silence until the timeout — means we can't count on
 * it, which is the only distinction that matters here. We separate out
 * "unreachable" so a dead relay doesn't get labelled as merely unsupported.
 */
export function probeCountSupport(url: string, timeoutMs = 5000): Promise<CountSupport> {
  const cached = cache.get(url)
  if (cached === 'yes' || cached === 'no' || cached === 'unreachable') return Promise.resolve(cached)
  const running = inflight.get(url)
  if (running) return running

  const promise = new Promise<CountSupport>((resolve) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      resolve('unreachable')
      return
    }

    let opened = false
    let settled = false
    const subId = `cap-${Math.random().toString(36).slice(2, 10)}`

    const finish = (result: CountSupport) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* already closing */ }
      resolve(result)
    }

    const timer = setTimeout(() => finish(opened ? 'no' : 'unreachable'), timeoutMs)

    ws.onopen = () => {
      opened = true
      // limit:1 keeps the relay's work trivial regardless of how it implements COUNT.
      ws.send(JSON.stringify(['COUNT', subId, { kinds: [1], limit: 1 }]))
    }

    ws.onmessage = (ev) => {
      let msg: unknown
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') } catch { return }
      if (!Array.isArray(msg)) return
      const [type, id] = msg as [string, string]
      if (type === 'COUNT' && id === subId) finish('yes')
      // An explicit refusal is a definitive "no" — no need to wait out the timer.
      else if (type === 'NOTICE' || (type === 'CLOSED' && id === subId)) finish('no')
    }

    ws.onerror = () => finish(opened ? 'no' : 'unreachable')
    ws.onclose = () => finish(opened ? 'no' : 'unreachable')
  })

  inflight.set(url, promise)
  promise.then((result) => {
    cache.set(url, result)
    inflight.delete(url)
  })
  return promise
}

/** A previously probed answer, if we have one. */
export function cachedCountSupport(url: string): CountSupport {
  return cache.get(url) ?? 'unknown'
}
