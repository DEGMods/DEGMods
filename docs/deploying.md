# Deploying DEG MODS

Two supported targets: **GitHub Pages** (zero infrastructure, what degmods.com
runs on) and **a Linux server** behind nginx. The app is a static SPA reading
from Nostr relays, so both amount to "build, serve `dist/`, point a domain at
it" — the differences are in SPA routing, the sitemap cron, and which defaults
are safe.

Read [Make it yours](#make-it-yours) before either guide. Those settings all
*work* untouched, which is exactly why they get missed.

---

## Make it yours

A fork that skips this still builds and runs. It just isn't really yours.

### Admin key — read this one

```ts
// src/lib/constants.ts
export const ADMIN_PUBKEY = 'f4bf1fb5ba8be839f70c7331733e309f780822b311f63e01f9dc8abbb428f8d5'
```

This pubkey's NIP-78 events drive **site ads, featured games, moderation lists,
excluded tags and the announcement banner** on your deployment. Leave it and
DEG MODS' admin configures your site — silently, and from then on, whenever they
publish. Nothing breaks, nothing warns you.

Replace it with your own npub's hex pubkey. The Admin tab in Settings only
appears for whoever this is.

### Analytics

```ts
export const UMAMI_SCRIPT_URL = 'https://an.degmods.com/script.js'
export const UMAMI_WEBSITE_ID = '5738aafa-e5ab-4e8a-b92b-41828ddd9c1b'
export const UMAMI_HOST = 'degmods.com'
```

Umami accepts any request carrying a valid website id — it has no domain
allowlist, and the id is readable in any deployed bundle. So without a guard, a
fork would file its traffic under DEG MODS' numbers.

`UMAMI_HOST` is that guard: analytics only loads when the page is served from
that domain or a subdomain of it. A fork on `bananamods.com` therefore reports
nothing until it sets its own values — and local development doesn't report
either, which is the other half of the point.

Set all three to your own, or clear `UMAMI_HOST` to report from anywhere, or
delete the `useAnalytics()` call in
[`MainLayout`](../src/components/layout/MainLayout.tsx) to drop analytics
entirely.

> The guard is client-side, so it only stops honest mistakes. If you host Umami
> yourself, also reject foreign origins at the web server — that's the boundary
> that actually holds:
>
> ```nginx
> location /api/send {
>     if ($http_origin !~* ^https://([a-z0-9-]+\.)?example\.com$) { return 403; }
>     proxy_pass http://127.0.0.1:3000;
> }
> ```

### Relays and media servers

[`src/lib/relays.json`](../src/lib/relays.json) and `DEFAULT_BLOSSOMS` in
constants both list `brs.degmods.com`. It's DEG MODS' own relay and mod-file
store: it accepts only mod and mod-jam kinds, and it is **pinned** for uploads.
A fork relying on it is depending on someone else's storage, which may reject
you or simply stop existing. Swap in your own, or drop it and keep the public
relays.

`relays.json` is shared with the sitemap generator so the client and the
crawler can't drift — change it in one place and both follow.

### Domain file

[`public/CNAME`](../public/CNAME) is GitHub Pages only. Set it for that target;
delete it for a Linux server, where it's just a stray file naming someone
else's domain.

---

## Guide A — GitHub Pages

What degmods.com uses. Free, no server, and the sitemap cron comes along with
it.

### 1. Enable Pages

**Settings → Pages → Source: GitHub Actions.**

That's the whole setup — [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
already builds, generates the sitemap, and deploys. It runs on push to
`main`/`master`, every 6 hours (to refresh the sitemap), and on demand.

### 2. Point your domain

1. Put your domain in [`public/CNAME`](../public/CNAME), one line, no protocol:
   ```
   example.com
   ```
2. At your DNS provider, for an apex domain add A records to GitHub's IPs:
   ```
   185.199.108.153
   185.199.109.153
   185.199.110.153
   185.199.111.153
   ```
   For a subdomain, a single `CNAME` to `<user>.github.io` instead.
3. **Settings → Pages → Custom domain**, enter it, and tick **Enforce HTTPS**
   once the certificate is issued.

### 3. Configure the build

Repository variables, **not** environment variables — see the warning below.

**Settings → Secrets and variables → Actions → Variables tab → New repository
variable.**

| Variable | Default | Set it when |
|---|---|---|
| `SITE_URL` | `https://degmods.com` | Always, on a fork — it's the base URL written into every sitemap entry. |
| `SEO_DISALLOW` | `true` | Set `false` to allow search engines. See [SEO](#seo). |
| `SEO_RELAYS` | the shipped relay list | You want the crawler to read different relays. |
| `SEO_MIN_POW` | `15` | You want a different spam floor. |
| `SEO_MAX` | `1000000` | You want to bound how far back it walks. |

> **⚠️ Repository variables, not environment variables.**
> The `github-pages` *environment* page also offers variables, and setting them
> there looks equivalent. It isn't. The sitemap runs in the `build` job, which
> declares no `environment:` — only `deploy` does. An environment-scoped
> variable is invisible to `build`, so the workflow falls back to its default
> and you get the opposite of what you set, with no error.

---

## Guide B — Linux server (nginx)

For a VPS, home server, or anywhere you control the web server.

### 1. Build

```bash
git clone <your-fork> && cd "DEG Mods"
npm ci
npm run build          # NOT build:ghpages — see below
```

Output lands in `dist/`. Copy it wherever nginx will serve it:

```bash
sudo rsync -a --delete dist/ /var/www/degmods/
```

> **Use `npm run build`, not `npm run build:ghpages`.**
> The `:ghpages` variant copies `index.html` over `404.html`, which is a
> GitHub Pages workaround for SPA routing. nginx does it properly with
> `try_files`.

### 2. Remove the GitHub Pages SPA shim

Pages can't rewrite URLs, so the repo ships the
[spa-github-pages](https://github.com/rafgraph/spa-github-pages) trick: a
`404.html` that encodes the path into a query string, and a script in
`index.html` that decodes it back. With `try_files` this is unnecessary, and
leaving it in makes URLs briefly flicker through `/?/mod/naddr…`.

- delete [`public/404.html`](../public/404.html)
- delete the `spa-github-pages` `<script>` block near the top of
  [`index.html`](../index.html)
- delete [`public/CNAME`](../public/CNAME)

### 3. nginx

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    root /var/www/degmods;
    index index.html;

    # Every unknown path is a client-side route.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Hashed assets are immutable; index.html must never be cached, or a
    # deploy leaves browsers loading a stale shell that references
    # assets that no longer exist.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
}

server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`. For TLS,
`sudo certbot --nginx -d example.com`.

DNS: an `A` record for the apex (and `AAAA` if you have IPv6) pointing at the
server's IP.

### 4. Serving from a subpath

Only if the app lives at `example.com/mods/` rather than a domain root — set
`base` in [`vite.config.ts`](../vite.config.ts):

```ts
export default defineConfig({
  base: '/mods/',
  // …
})
```

Without it every asset URL resolves against `/` and the page loads blank.

### 5. Sitemap and robots.txt — you must run this yourself

There is no Actions runner, so **nothing generates them unless you do**:

```bash
SITE_URL=https://example.com SEO_DISALLOW=false node scripts/generate-sitemap.mjs
```

Run it after each build, and on a cron so it picks up new and deleted posts —
the GitHub workflow does this every 6 hours:

```cron
0 */6 * * * cd /opt/degmods && SITE_URL=https://example.com SEO_DISALLOW=false SEO_OUT=/var/www/degmods node scripts/generate-sitemap.mjs
```

`SEO_OUT` (default `dist`) is where it writes, so point it at the served
directory when building elsewhere.

> **⚠️ Skipping this leaves your site fully crawlable.**
> `robots.txt` is written *by this script*; there is no `public/robots.txt`. So
> a self-host that just builds and serves has **no robots.txt at all**, and
> crawlers treat that as permission. This is the exact inverse of GitHub Pages,
> where absent configuration means disallow-all. Run the script with
> `SEO_DISALLOW=true` on any staging box.

---

## SEO

The mechanism — per-page meta, sharded sitemaps, the proof-of-work spam floor —
is documented in [seo.md](./seo.md). This is only how to turn it on and off.

**One switch: `SEO_DISALLOW`.**

| Value | `robots.txt` | Sitemap |
|---|---|---|
| `true`, `1`, `yes`, `on` | `Disallow: /` | not generated |
| anything else / unset on a self-host | allow-all | generated |
| unset on GitHub Pages | `Disallow: /` | not generated |

That last row is the important asymmetry: the workflow defaults to `'true'`, so
**absent configuration is safe on Pages and unsafe on a self-host.**

### Going live

Flip the domain and SEO in the **same** deploy. If you enable SEO while still on
a staging domain, `robots.txt` starts inviting crawlers to *that* domain while
the sitemap it emits lists your production URLs — you get the staging site
indexed and duplicate content to clean up afterwards.

- **GitHub Pages:** update `public/CNAME`, set `SITE_URL`, set
  `SEO_DISALLOW=false`, push.
- **Self-host:** update nginx `server_name` and DNS, then run the sitemap
  script with the new `SITE_URL` and `SEO_DISALLOW=false`.

### Verifying

```bash
curl https://example.com/robots.txt      # Disallow: / or an allow-all + Sitemap: line
curl -I https://example.com/sitemap.xml  # 404 when disallowed, 200 when enabled
```

Check a deep link too — `https://example.com/mods` should render the page, not
a 404. That's the single best test of SPA routing on either target.

---

## Future revisions

Two planned changes will date parts of this document:

- **Desktop build (Tauri).** Bundling the app locally sidesteps web hosting
  entirely, so most of this stops applying — but analytics gains a real
  consideration: a desktop app has no ad blocker and no address bar, so a user
  has no way to see or stop it. It should be opt-**in** there, not opt-out as it
  is on the web.
- **Author mode.** The planned switch from a shared hub to running the client as
  a single creator's site changes what `ADMIN_PUBKEY` means — in that mode the
  author *is* the admin, so the "Make it yours" section above needs rewriting
  around whichever config selects the mode.
