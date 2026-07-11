# SEO & Discoverability

DEG MODS is a client-rendered SPA reading from Nostr relays, so out of the box a
crawler hitting `/mod/<naddr>` would only see an empty shell. This setup makes
mods, blogs, profiles, and game pages discoverable **with zero extra infra or
cost** — it runs entirely on free GitHub Actions + GitHub Pages, so any fork
gets it just by deploying.

It deliberately targets **search discoverability (Google), not social link
cards.** Google renders JS, so per-page meta works for it. Non-JS social
scrapers (X/Discord/Facebook unfurls) would need a build-time prerender layer,
which we intentionally don't do here.

## How it works

**1. Per-page meta (client-side).** [`useSeoMeta`](../src/hooks/useSeoMeta.ts)
sets `<title>`, description, canonical, and Open Graph / Twitter tags from the
loaded event on the mod, blog, profile, and game pages, using the pure
[`buildMeta`](../src/lib/seo/buildMeta.ts) helper. Googlebot runs this
on render, so each page gets a real title/description.

**2. Sitemap (build-time).** [`scripts/generate-sitemap.mjs`](../scripts/generate-sitemap.mjs)
runs after the build (and on a ~6-hourly cron). It:

- fetches recent mods (kind 31142) and blogs (30023) from relays — the same
  relays the app uses, read from the shared
  [`src/lib/relays.json`](../src/lib/relays.json) so the two can't
  drift — paginating newest→oldest in 500-event windows;
- dedupes by addressable coordinate keeping the latest version, so **edits just
  bump the URL's `<lastmod>`** (the `naddr` URL never changes on edit);
- prunes coordinates referenced by kind-5 deletions (best-effort);
- **drops posts below `SEO_MIN_POW`** (NIP-13 leading zero bits, default 15) —
  this blocks SEO spam and, because DEG MODS publishes with proof-of-work while
  random other-client posts don't, doubles as a "is this real DEG MODS content"
  filter (it mirrors the app's default content-filter PoW);
- writes sharded `sitemap-content-*.xml`, a `sitemap-static.xml`, a `sitemap.xml`
  index, and `robots.txt` into the build output.

It is **stateless and bounded** — each run re-fetches the window back to
`SEO_MAX` coordinates per kind (default **1,000,000**). No database. With the
fetch's early-exit (it stops when relays run dry), a small catalog is covered in
full; the cap only bites once a kind genuinely exceeds it.

History is anchored on **`published_at`** (the stable original-publication tag),
not `created_at` — some clients reset `created_at` on edit, so it's only used for
`<lastmod>` (the freshness signal). Relays only order by `created_at`, so the
script *walks* by `created_at` but *sorts/caps* by `published_at`.

**3. Deploy ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)).**
Builds → generates the sitemap → deploys to Pages, on push, **every ~6h** (to
fold in new/edited/deleted posts), and manually.

## Fork / deploy setup

Two things must be done in the GitHub web UI (they can't live in code):

1. **Required —** Settings → **Pages** → Source: **GitHub Actions**.
2. **Recommended —** Settings → **Secrets and variables → Actions → Variables**
   → *New repository variable*:

   | Variable | Purpose | Default |
   |---|---|---|
   | `SITE_URL` | Canonical base URL for sitemap/links | `https://degmods.com` |
   | `SEO_RELAYS` | Comma-separated relays to index from. Defaults to the app's relays (`src/lib/relays.json`); set this **only** if you publish to relays beyond those. | app defaults |
   | `SEO_MAX` | Max coordinates per kind | `1000000` |
   | `SEO_MIN_POW` | Min NIP-13 proof-of-work (leading zero bits) for a post to be listed. `0` disables. | `15` |

That's it — push, and the scheduled job keeps the sitemap current.

### Custom domain & forks

- **Custom domain (e.g. `degmods.com`):** set it in Settings → Pages. A
  [`public/CNAME`](../public/CNAME) file is included so the domain
  persists across Actions deploys (they can otherwise drop it).
- **Forks** must enable the **Actions** tab (and scheduled runs stay off on a
  fork until enabled).
- **Base path:** the app's Vite `base` is `/`, correct for a custom domain or a
  user/org root Pages site. A fork served from a *project subpath*
  (`user.github.io/repo/`) needs `base` + the router basename set to `/repo/` —
  a small code change, not just a setting.

## Scaling note

The default `SEO_MAX` of 1,000,000 per kind (≈2M URLs ≈ ~300 MB of sitemap XML)
fits **same-origin on GitHub Pages** (≈1 GB soft limit ≈ 6–7M URLs), so this
zero-infra path covers essentially any realistic catalog with **no Blossom, no
cross-domain sitemap, and no in-client builder**. A full re-walk of a large
catalog is ~20–30 min of relay queries, which is why the cron runs every ~6h
rather than hourly.

Only if an instance ever blows past **~6M URLs** (Pages' size limit) does the
decentralized tier become necessary: a separately-deployable indexer that shards
the sitemap by time period, uploads immutable shards to **Blossom** (mirrorable,
content-addressed), and announces the current index via a **NIP-78** event, with
the on-domain `/sitemap.xml` pointing out to it. That introduces a one-time
**Google Search Console** submission (cross-domain sitemaps must be associated
with the verified domain). It's documented here only as the escape hatch — it is
*not* needed under the 1M cap.
