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
 *
 * So these count on *render*: nothing is sent until the page resolves its event
 * and reports the canonical address (always the naddr/nevent, which never
 * varies). A post that never resolves — a dead relay, an address pointing at
 * nothing — is never counted, which is the honest reading: a spinner that
 * never became a post wasn't a view. This also means the short and naddr
 * spellings of one post are measured by the same rule, since neither can report
 * until the event is in hand.
 */
const CANONICAL_ROUTES = ['/mod/', '/blog/', '/mod-jam/', '/feed/note/']
const needsCanonical = (path: string) => CANONICAL_ROUTES.some((p) => path.startsWith(p))

/** The view waiting on a canonical address. Only one page is open at a time. */
let pendingView: { path: string; send: (url: string) => void } | null = null

/**
 * Called by the pages once they've resolved the event, with the address that
 * should be recorded. Derived from the event itself, so it needs no network and
 * fires the moment the post renders — whenever that is. There's no deadline: a
 * post that takes ten seconds to resolve is counted at ten seconds, and one
 * that never resolves is never counted.
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
    // return, while the first run's pending slot was already cleared by its own
    // cleanup — so nothing would be listening and the view would never be sent.
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
    // post is one row however the visitor spelled the URL. No deadline: the
    // report fires when the event renders, however long that takes, and if it
    // never renders the view is simply never sent. Cleanup clears the slot on
    // navigation, so leaving before the post resolves drops it too.
    pendingView = { path, send }
    return () => {
      if (pendingView?.path === path) pendingView = null
    }
  }, [enabled, location.pathname, location.search])
}
