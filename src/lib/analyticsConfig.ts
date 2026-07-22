/**
 * Analytics configuration — kept dependency-free on purpose.
 *
 * These values are needed in two places that can't share normal imports: the
 * app, and the bootstrap snippet baked into index.html at build time (see the
 * `analytics-bootstrap` plugin in vite.config.ts). Anything imported here would
 * be pulled into the Vite config too, so this file stays a leaf.
 *
 * Re-exported by lib/constants.ts, which is where the docs point forkers.
 */

/**
 * Self-hosted Umami. Cookieless and stores no personal data, but it's still a
 * request to a server on every page, so it's behind a setting users can turn off.
 *
 * The website id is carried over from the previous DEG Mods site: most routes
 * are unchanged, so keeping it preserves the history behind /ads' audience
 * figures rather than restarting from zero.
 */
export const UMAMI_SCRIPT_URL = 'https://an.degmods.com/script.js'
export const UMAMI_WEBSITE_ID = '5738aafa-e5ab-4e8a-b92b-41828ddd9c1b'

/**
 * Only report from this domain (and its subdomains).
 *
 * Umami has no domain allowlist — anything that posts a website id is counted,
 * and the id is readable in any deployed bundle. So a fork that changes its
 * domain but not these constants would file its traffic under ours, and local
 * development would do the same. This keeps that from happening by accident.
 *
 * A fork should set this to its own domain, or clear it to report from anywhere.
 * The server hosting Umami should also reject foreign origins — this guard is
 * for honest mistakes, not for anyone determined.
 */
export const UMAMI_HOST = 'degmods.com'

/** localStorage key holding the posting-behaviour blob, which carries the opt-out. */
export const POSTING_BEHAVIOUR_KEY = 'deg-mods:posting-behaviour'

/** Marks the id of the injected script tag, so the app doesn't add a second one. */
export const UMAMI_SCRIPT_ID = 'umami-analytics'
