import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

import pkg from './package.json'
import {
  UMAMI_SCRIPT_URL, UMAMI_WEBSITE_ID, UMAMI_HOST,
  POSTING_BEHAVIOUR_KEY, UMAMI_SCRIPT_ID,
} from './src/lib/analyticsConfig'

/**
 * Bake the analytics bootstrap into index.html.
 *
 * The app can't do this itself: loading the script from a React effect means
 * nothing is counted until the whole bundle has downloaded, parsed and mounted —
 * so every visitor who leaves before that is invisible. This runs from the HTML
 * instead, before any of it.
 *
 * It deliberately does NOT enable Umami's auto-tracking. Auto-track hooks
 * pushState *and* replaceState, and this client rewrites the URL when a post's
 * short address resolves, so one visit would be counted two or three times. The
 * landing view is sent explicitly here; the app sends the rest.
 *
 * Written into the HTML rather than imported so it runs immediately, and
 * generated from the same constants the app uses so the two can't drift.
 */
function analyticsBootstrap(): Plugin {
  const snippet = `
    (function () {
      try {
        var host = ${JSON.stringify(UMAMI_HOST)};
        if (host && location.hostname !== host && !location.hostname.endsWith('.' + host)) return;

        // Same opt-out the settings toggle writes. Absent means "not yet chosen",
        // which is the default-on state.
        var raw = localStorage.getItem(${JSON.stringify(POSTING_BEHAVIOUR_KEY)});
        if (raw && JSON.parse(raw).analyticsEnabled === false) return;

        // Post routes resolve an event before they can name themselves, so they
        // report their own view once rendered (see useAnalytics). Everything else
        // is its own content and can be counted the moment it's asked for.
        var path = location.pathname;
        var deferred = ['/mod/', '/blog/', '/mod-jam/', '/feed/note/'];
        for (var i = 0; i < deferred.length; i++) {
          if (path.indexOf(deferred[i]) === 0) return;
        }

        var url = path + location.search;
        var s = document.createElement('script');
        s.id = ${JSON.stringify(UMAMI_SCRIPT_ID)};
        s.async = true;
        s.src = ${JSON.stringify(UMAMI_SCRIPT_URL)};
        s.setAttribute('data-website-id', ${JSON.stringify(UMAMI_WEBSITE_ID)});
        s.setAttribute('data-auto-track', 'false');
        s.addEventListener('load', function () {
          if (window.umami) {
            window.umami.track({ url: url });
            // Tells the app this one is already counted, so it doesn't repeat it.
            window.__umamiLandingSent = url;
          }
        });
        document.head.appendChild(s);
      } catch (e) {
        // Analytics must never break the page.
      }
    })();
  `.trim()

  return {
    name: 'analytics-bootstrap',
    transformIndexHtml() {
      return [{ tag: 'script', children: snippet, injectTo: 'head' }]
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), analyticsBootstrap()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // @noble/hashes exports use ".js" suffixes that Vite 8 doesn't auto-resolve.
      '@noble/hashes/hmac': path.resolve(__dirname, 'node_modules/@noble/hashes/hmac.js'),
      '@noble/hashes/sha256': path.resolve(__dirname, 'node_modules/@noble/hashes/sha2.js'),
      '@noble/hashes/sha2': path.resolve(__dirname, 'node_modules/@noble/hashes/sha2.js'),
      '@noble/hashes/utils': path.resolve(__dirname, 'node_modules/@noble/hashes/utils.js'),
      '@noble/hashes/hkdf': path.resolve(__dirname, 'node_modules/@noble/hashes/hkdf.js'),
      '@noble/hashes/sha3': path.resolve(__dirname, 'node_modules/@noble/hashes/sha3.js'),
      '@noble/curves/secp256k1': path.resolve(__dirname, 'node_modules/@noble/curves/secp256k1.js'),
      '@scure/bip39/wordlists/english': path.resolve(__dirname, 'node_modules/@scure/bip39/wordlists/english.js'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
})
