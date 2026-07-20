import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useSettingsStore } from '@/stores/settingsStore'
import { UMAMI_SCRIPT_URL, UMAMI_WEBSITE_ID } from '@/lib/constants'

const SCRIPT_ID = 'umami-analytics'

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
  const enabled = useSettingsStore((s) => s.analyticsEnabled)
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
