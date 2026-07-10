/**
 * NIP-11 relay information document.
 *
 * Fetched over HTTP from the relay's URL with the `application/nostr+json`
 * Accept header. Requires the relay to send CORS headers; relays that don't
 * (or are unreachable) return null — callers treat that as "no NIP-50".
 */
export async function fetchRelaySupportedNips(wsUrl: string): Promise<number[] | null> {
  const httpUrl = wsUrl
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://')
    .replace(/\/+$/, '')
  try {
    const res = await fetch(httpUrl, {
      headers: { Accept: 'application/nostr+json' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const info = await res.json()
    const nips = info?.supported_nips
    return Array.isArray(nips) ? nips.filter((n: unknown): n is number => typeof n === 'number') : []
  } catch {
    return null
  }
}
