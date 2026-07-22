/**
 * Build-time SEO sitemap generator (zero infra — runs in GitHub Actions).
 *
 * Fetches recent mods (31142), blogs (30023) and mod jams (31143) from public
 * relays, dedupes by addressable coordinate (latest version wins → handles
 * edits), drops tombstoned posts and coordinates deleted via kind 5, and writes
 * sharded sitemap(s) + a sitemap index + robots.txt into the build output.
 * Stateless and bounded: each run covers the recent window back to SEO_MAX
 * entries, so it's fully forkable with no DB.
 *
 * Legacy mods (30402) are deliberately absent — see the note in ModPage; they
 * emit no meta either, so listing them would advertise pages that describe
 * themselves only with site defaults.
 *
 * Config via env (all optional):
 *   SITE_URL     canonical base URL         (default https://degmods.com)
 *   SEO_RELAYS   comma-separated relay list
 *   SEO_MAX      max coordinates per kind   (default 1000000)
 *   SEO_OUT      output directory           (default dist)
 *   SEO_DISALLOW when truthy, emit a Disallow-all robots.txt and skip the
 *                sitemap entirely — for staging/temp deploys that must stay out
 *                of search. Set it to `false` on the real domain to enable SEO.
 *
 * NOTE for self-hosted deploys: robots.txt is written *here*, and there is no
 * public/robots.txt fallback. A deploy that builds and serves dist/ without
 * running this script therefore ships no robots.txt at all — which crawlers
 * read as permission. That's the opposite of the GitHub Pages path, where the
 * workflow defaults SEO_DISALLOW to "true" and absent config means disallow.
 * Run this with SEO_DISALLOW=true on any staging box. See docs/deploying.md.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool'
import { nip19 } from 'nostr-tools'

// Default relays come from the same file the app uses, so they can't drift.
const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_RELAYS = JSON.parse(readFileSync(join(HERE, '../src/lib/relays.json'), 'utf8'))
  .filter((r) => r.read).map((r) => r.url)

// nostr-tools needs a WebSocket impl in Node. Node 22 ships a global one; on
// older Node fall back to the optional `ws` package.
if (typeof globalThis.WebSocket !== 'undefined') {
  useWebSocketImplementation(globalThis.WebSocket)
} else {
  try {
    const { WebSocket } = await import('ws')
    useWebSocketImplementation(WebSocket)
  } catch {
    console.error('No WebSocket available — use Node ≥22 or `npm i -D ws`.')
    process.exit(1)
  }
}

const SITE_URL = (process.env.SITE_URL || 'https://degmods.com').replace(/\/+$/, '')
const RELAYS = (process.env.SEO_RELAYS ? process.env.SEO_RELAYS.split(',') : DEFAULT_RELAYS)
  .map(s => s.trim()).filter(Boolean)
const MAX_PER_KIND = Number(process.env.SEO_MAX || 1_000_000)
// Minimum NIP-13 proof-of-work (leading zero bits of the event id) for a post
// to be sitemap-eligible. Blocks spam and scopes the sitemap to real DEG MODS
// content (which publishes with PoW). Set to 0 to disable. Empty/unset → 15.
const MIN_POW = process.env.SEO_MIN_POW ? Number(process.env.SEO_MIN_POW) : 15
const OUT_DIR = process.env.SEO_OUT || 'dist'
// Staging guard: keep temp/preview deploys out of search engines.
const DISALLOW = /^(1|true|yes|on)$/i.test(String(process.env.SEO_DISALLOW || ''))

const MOD_KIND = 31142
const BLOG_KIND = 30023
const JAM_KIND = 31143
const PAGE = 500
const URLS_PER_SITEMAP = 20000
const QUERY_TIMEOUT = 8000

const KIND_PATH = { [MOD_KIND]: 'mod', [BLOG_KIND]: 'blog', [JAM_KIND]: 'mod-jam' }

/** Self-tombstone: the post still exists as an event but renders as deleted. */
const isTombstoned = (ev) => ev.tags.some(t => t[0] === 'deleted' && t[1] === 'true')

/**
 * Extra per-kind admission rules, on top of the shared ones in fetchKind.
 *
 * Jams are a shared kind: `j` names what the jam is for, and this client only
 * renders `j=mod`. Listing a game jam would advertise a URL that resolves to
 * "not found" here. The client tag is required too, so jams minted by tooling
 * that doesn't identify itself stay out of the index.
 */
const KIND_ACCEPT = {
  [JAM_KIND]: (ev) =>
    ev.tags.some(t => t[0] === 'j' && t[1] === 'mod') &&
    ev.tags.some(t => t[0] === 'client' && t[1]),
}

/** NIP-13 proof-of-work: count leading zero bits of an event id (hex). */
function countLeadingZeroBits(hex) {
  let count = 0
  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16)
    if (nibble === 0) { count += 4; continue }
    count += Math.clz32(nibble) - 28
    break
  }
  return count
}

/**
 * Walk a replaceable kind newest→oldest in PAGE-sized windows. Relays only
 * order by created_at, so we paginate by that; but we record published_at (the
 * stable original-publication tag) as the history anchor — created_at is reset
 * on edit by some clients, so it's only trustworthy for <lastmod> (freshness).
 */
async function fetchKind(pool, kind) {
  const byCoord = new Map() // coord -> { created_at, published_at, pubkey, identifier }
  let until = Math.floor(Date.now() / 1000)

  while (byCoord.size < MAX_PER_KIND) {
    const events = await pool.querySync(RELAYS, { kinds: [kind], until, limit: PAGE }, { maxWait: QUERY_TIMEOUT })
    if (!events.length) break

    let oldest = until
    for (const ev of events) {
      if (ev.created_at < oldest) oldest = ev.created_at // advance the cursor past spam too
      const d = ev.tags.find(t => t[0] === 'd')?.[1]
      if (!d) continue
      const coord = `${kind}:${ev.pubkey}:${d}`
      const prev = byCoord.get(coord)
      if (prev && ev.created_at <= prev.created_at) continue

      // Admission is recorded on the newest revision rather than used to skip
      // events, because skipping would hand the coordinate back to an older
      // revision that still qualified — a deleted post would stay in the
      // sitemap via its own pre-deletion copy. Deletion has to win, so the
      // latest revision decides, whatever it says.
      //
      // PoW is judged the same way but deliberately doesn't gate the tracking:
      // it's a spam filter for *listing*, and a tombstone should retract a post
      // even if it carries less work than the post did.
      const listable = (MIN_POW === 0 || countLeadingZeroBits(ev.id) >= MIN_POW) &&
        !isTombstoned(ev) &&
        (!KIND_ACCEPT[kind] || KIND_ACCEPT[kind](ev))
      const publishedAt = Number(ev.tags.find(t => t[0] === 'published_at')?.[1]) || ev.created_at
      byCoord.set(coord, { created_at: ev.created_at, published_at: publishedAt, pubkey: ev.pubkey, identifier: d, listable })
    }

    if (oldest >= until) break          // no forward progress
    until = oldest - 1
    if (events.length < PAGE) break     // relay exhausted this window
  }
  return byCoord
}

/** Best-effort: recent kind-5 deletions referencing addressable coordinates. */
async function fetchDeletedCoords(pool) {
  const deleted = new Set()
  try {
    const events = await pool.querySync(RELAYS, { kinds: [5], limit: PAGE }, { maxWait: QUERY_TIMEOUT })
    for (const ev of events) {
      for (const t of ev.tags) if (t[0] === 'a' && t[1]) deleted.add(t[1])
    }
  } catch { /* deletions are best-effort */ }
  return deleted
}

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
}

function urlXml({ loc, lastmod }) {
  return `  <url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`
}

function writeXml(file, body) {
  writeFileSync(join(OUT_DIR, file), `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`)
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  // Staging: block all crawlers and emit no sitemap. One flag flip (SEO_DISALLOW
  // → false) turns SEO back on for the production domain.
  if (DISALLOW) {
    writeFileSync(join(OUT_DIR, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
    console.log('sitemap: SEO_DISALLOW set — wrote Disallow-all robots.txt, skipped sitemap')
    return
  }

  const pool = new SimplePool()

  // Sequential, not Promise.all. Each walk paginates against the same 15
  // relays, and running them together made slow relays miss the per-query
  // deadline — the jam walk came back with 1 of 3 events, so a live jam was
  // silently left out of the sitemap. Partial results are the one failure this
  // script must not have: a missing URL looks identical to a deleted one.
  // Build time is irrelevant here; it runs on a 6-hourly cron.
  const mods = await fetchKind(pool, MOD_KIND)
  const blogs = await fetchKind(pool, BLOG_KIND)
  const jams = await fetchKind(pool, JAM_KIND)
  const deleted = await fetchDeletedCoords(pool)

  /** Coordinate map → sitemap url entries. */
  const toEntries = (map, kind) => {
    const out = []
    for (const [coord, info] of map) {
      if (!info.listable) continue
      if (deleted.has(coord)) continue
      let naddr
      try { naddr = nip19.naddrEncode({ kind, pubkey: info.pubkey, identifier: info.identifier }) } catch { continue }
      out.push({
        loc: `${SITE_URL}/${KIND_PATH[kind]}/${naddr}`,
        lastmod: new Date(info.created_at * 1000).toISOString(), // freshness
        published_at: info.published_at,                          // history anchor
      })
    }
    return out
  }

  const content = [...toEntries(mods, MOD_KIND), ...toEntries(blogs, BLOG_KIND), ...toEntries(jams, JAM_KIND)]
    .sort((a, b) => b.published_at - a.published_at) // newest by original publication first

  // Static, always-present pages.
  const staticPages = ['', 'mods', 'blog', 'games', 'faq', 'guides', 'ads', 'mod-jams']
    .map(p => ({ loc: `${SITE_URL}/${p}`.replace(/\/$/, '') || SITE_URL }))

  // Shard content sitemaps; static pages get their own.
  const shards = []
  for (let i = 0; i < content.length; i += URLS_PER_SITEMAP) shards.push(content.slice(i, i + URLS_PER_SITEMAP))

  const sitemapFiles = []
  writeXml('sitemap-static.xml',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${staticPages.map(urlXml).join('\n')}\n</urlset>`)
  sitemapFiles.push('sitemap-static.xml')

  shards.forEach((shard, i) => {
    const file = `sitemap-content-${i}.xml`
    writeXml(file, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${shard.map(urlXml).join('\n')}\n</urlset>`)
    sitemapFiles.push(file)
  })

  // Sitemap index.
  const indexBody = sitemapFiles
    .map(f => `  <sitemap><loc>${SITE_URL}/${f}</loc></sitemap>`)
    .join('\n')
  writeXml('sitemap.xml', `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexBody}\n</sitemapindex>`)

  // robots.txt with the sitemap pointer.
  writeFileSync(join(OUT_DIR, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`)

  pool.close(RELAYS)
  // Counted after the listable filter, so the numbers match what was written
  // rather than how many coordinates were seen.
  const listable = (map) => [...map.values()].filter(i => i.listable).length
  console.log(`sitemap: ${content.length} content urls (${listable(mods)} mods, ${listable(blogs)} blogs, ${listable(jams)} jams, minPow=${MIN_POW}, ${deleted.size} deletions pruned) across ${sitemapFiles.length} files → ${OUT_DIR}`)
}

main().catch(err => { console.error('sitemap generation failed:', err); process.exit(1) })
