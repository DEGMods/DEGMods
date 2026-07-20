import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useSettingsStore } from '@/stores/settingsStore'
import { UMAMI_SCRIPT_URL, UMAMI_WEBSITE_ID, UMAMI_HOST } from '@/lib/constants'

const SCRIPT_ID = 'umami-analytics'

/**
 * Routes whose URL identifies a post, and therefore has more than one spelling.
 *
 * The same mod is reachable as `/mod/<naddr>`, `/mod/snpub1…<code>`, or
 * `/mod/sn<dnn-id><code>` — and the short form can gain a `-<selector>` suffix
 * if the author ever has a colliding code. Recording whichever one the visitor
 * happened to use would scatter a single post across several dashboard rows.
 * So these wait for the page to report a canonical address (always the
 * naddr/nevent, which never varies) before the view is sent.
 */
const CANONICAL_ROUTES = ['/mod/', '/blog/', '/mod-jam/', '/feed/note/']
const needsCanonical = (path: string) => CANONICAL_ROUTES.some((p) => path.startsWith(p))

/**
 * The address forms that already identify a post uniquely and never vary: naddr
 * for addressable posts, nevent/note for notes. Recording one of these can't
 * scatter a post across rows.
 *
 * A short address (`s…`) is the opposite — it's one of several spellings, and it
 * can't be turned back into its naddr without the event it encodes. So when the
 * backstop fires, we record a canonical URL but drop an unresolved short one
 * rather than file the view under a per-spelling row.
 */
const CANONICAL_PREFIXES = ['naddr1', 'nevent1', 'note1']
const isCanonicalAddress = (pathname: string): boolean => {
  const last = pathname.split('/').filter(Boolean).pop() ?? ''
  return CANONICAL_PREFIXES.some((p) => last.startsWith(p))
}

/** How long to wait for that report before giving up and sending what we have. */
const CANONICAL_TIMEOUT = 4000

/** The view waiting on a canonical address. Only one page is open at a time. */
let pendingView: { path: string; send: (url: string) => void } | null = null

/**
 * Called by the pages once they've resolved the event, with the address that
 * should be recorded. Derived from the event itself, so it needs no network and
 * normally lands well before the timeout.
 */
export function reportCanonicalPath(canonical: string): void {
  const pending = pendingView
  if (!pending) return
  pendingView = null
  pending.send(canonical)
}

/**
 * Is this page actually served from the domain analytics is configured for?
 *
 * Matched on a dot boundary rather than a plain suffix, so `degmods.com` and
 * `temp.degmods.com` pass while `notdegmods.com` doesn't. An empty UMAMI_HOST
 * means "report from anywhere", for forks that don't care.
 */
function onConfiguredHost(): boolean {
  if (!UMAMI_HOST) return true
  const host = window.location.hostname
  return host === UMAMI_HOST || host.endsWith(`.${UMAMI_HOST}`)
}

declare global {
  interface Window {
    umami?: { track: (payload?: unknown) => void }
  }
}

/**
 * Self-hosted Umami, loaded only while the setting is on.
 *
 * Turning it off removes the script rather than merely ignoring it, so a reader
 * who opts out stops making requests to the analytics host entirely instead of
 * being counted silently.
 *
 * Auto-tracking is deliberately disabled. Umami's tracker patches
 * `history.pushState` and `history.replaceState`, and this client rewrites the
 * URL with replaceState whenever a post's short address resolves — so a single
 * page view would be counted two or three times as the address upgrades from
 * naddr to short form. Page views are sent from the router's location instead,
 * which only changes on real navigation.
 */
export function useAnalytics() {
  // Both must hold: the reader hasn't opted out, and this is our own domain
  // rather than a fork or a dev server.
  const enabled = useSettingsStore((s) => s.analyticsEnabled) && onConfiguredHost()
  const location = useLocation()
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    const existing = document.getElementById(SCRIPT_ID)
    if (!enabled) {
      existing?.remove()
      delete window.umami
      lastPath.current = null
      return
    }
    if (existing) return

    const el = document.createElement('script')
    el.id = SCRIPT_ID
    el.async = true
    el.src = UMAMI_SCRIPT_URL
    el.dataset.websiteId = UMAMI_WEBSITE_ID
    el.dataset.autoTrack = 'false'
    document.head.appendChild(el)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const path = location.pathname + location.search
    // Guards on what was *sent*, not on what was started. Guarding on the start
    // would break the deferred path: React re-runs this effect (StrictMode does
    // it on every mount), the re-run would see the path as already handled and
    // return, while the first run's pending timer was cleared by its own
    // cleanup — so the view would never be sent at all.
    if (lastPath.current === path) return

    // The script loads async, so the first view can land before it's ready.
    let sent = false
    let tries = 0
    const send = (url: string) => {
      if (sent || lastPath.current === path) return
      if (window.umami) {
        sent = true
        lastPath.current = path
        // An explicit url, rather than letting the tracker read the address
        // bar — by the time this fires the bar may hold a short address.
        window.umami.track({ url })
        return
      }
      if (tries++ < 20) setTimeout(() => send(url), 250)
    }

    if (!needsCanonical(path)) {
      send(path)
      return
    }

    // Hold the view until the page reports the post's canonical address, so one
    // post is one row however the visitor spelled the URL. The timeout is a
    // backstop: if nothing reports (an unresolvable address, say), record what
    // we have rather than losing the view.
    pendingView = { path, send }
    const timer = setTimeout(() => {
      if (pendingView?.path !== path) return
      pendingView = null
      // Nothing reported in time — the event didn't resolve (a flaky relay, a
      // slow one, or an address that points at nothing). If the URL is already
      // a canonical naddr/nevent, record it: it lands in the post's own row,
      // same as a successful load would. But an unresolved short address can't
      // be turned into its naddr here, so recording it would scatter the post
      // across a per-spelling row. Drop it instead — a missing view beats a
      // wrong one.
      if (isCanonicalAddress(location.pathname)) send(path)
    }, CANONICAL_TIMEOUT)

    return () => {
      clearTimeout(timer)
      if (pendingView?.path === path) pendingView = null
    }
  }, [enabled, location.pathname, location.search])
}
