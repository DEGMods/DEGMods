import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useSettingsStore } from '@/stores/settingsStore'
import { UMAMI_SCRIPT_URL, UMAMI_WEBSITE_ID, UMAMI_HOST } from '@/lib/constants'

const SCRIPT_ID = 'umami-analytics'

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
    if (lastPath.current === path) return
    lastPath.current = path

    // The script loads async, so the first view can land before it's ready.
    let tries = 0
    const send = () => {
      if (window.umami) { window.umami.track(); return }
      if (tries++ < 20) setTimeout(send, 250)
    }
    send()
  }, [enabled, location.pathname, location.search])
}
