import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'
import { VitePWA } from 'vite-plugin-pwa'

// Build stamp injected into <meta name="fh-build">. Lets a live audit
// confirm which commit is actually deployed (audit L1). Netlify
// provides COMMIT_REF; falls back to local git for dev builds.
const BUILD_SHA = (() => {
  const env = process.env.COMMIT_REF || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA
  if (env) return env.slice(0, 12)
  try { return execSync('git rev-parse --short=12 HEAD').toString().trim() } catch { return 'dev' }
})()

// Year long immutable caching for hashed build output, written file by
// file into dist/_headers (Netlify reads it next to netlify.toml). A
// wildcard /assets/* header rule also matched chunks that a later deploy
// had removed, because Netlify matches header rules on the path, not the
// status. The browser then stored the reply for a missing chunk (the SPA
// page, or now the 404) as immutable for a year, still served it after a
// rollback brought the file back, and the service worker precache reads
// hashed URLs through that same HTTP cache. Listing only the files in
// this build keeps a missing chunk on Netlify's default revalidating
// policy. Do not add a public/_headers: it would collide with this file;
// put other headers in netlify.toml.
function immutableAssetHeaders() {
  return {
    name: 'fh-immutable-asset-headers',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const rules = Object.keys(bundle)
        .filter((fileName) => fileName.startsWith('assets/'))
        .sort()
        .map((fileName) => `/${fileName}\n  Cache-Control: public, max-age=31536000, immutable\n`)
      this.emitFile({ type: 'asset', fileName: '_headers', source: rules.join('') })
    }
  }
}

export default defineConfig({
  define: {
    __FH_BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __FH_BUILD_AT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    immutableAssetHeaders(),
    // Registration comes from public/registerSW.js (it skips customer
    // document links), which the plugin ships instead of generating one.
    VitePWA({
      registerType: 'autoUpdate',
      // skipWaiting + clientsClaim — without these, a deployed update
      // sits in the SW "waiting" state and never activates until every
      // tab is closed. Result: "I shipped the change but nothing's
      // live" because the SW keeps serving the old cached bundle on
      // every visit. With both true, the new SW takes over on the next
      // page load and the new assets are served immediately.
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Web-push handlers (push + notificationclick) live in
        // public/push-sw.js and are pulled into the generated SW here.
        importScripts: ['push-sw.js'],
        // Precache the app shell and every screen so the field app works
        // offline, but not chunks only an on demand feature loads. Each
        // install (and each deploy that changes them) would otherwise
        // download them for every user. Do not list a chunk that a screen
        // imports statically: vendor-jspdf and vendor-pdf-table stay in
        // because the Financials tab and ApproveQuoteSheet import them.
        globIgnores: [
          '**/node_modules/**/*',
          // jsPDF's optional HTML and SVG renderers (html2canvas,
          // DOMPurify, and canvg, which Rollup names index.es). They load
          // only for doc.html() or addSvgAsImage(), which the app never
          // calls.
          'assets/vendor-html2canvas-*.js',
          'assets/vendor-dompurify-*.js',
          'assets/index.es-*.js',
          // Recharts: only the Analytics screen imports it.
          'assets/vendor-charts-*.js',
          // Served by netlify.toml for missing /assets/ files only.
          '404.html',
        ],
        // index.html versions its icon links (?v=2) to bust browser
        // favicon caches; ignore that parameter so those requests still
        // hit the precached icons offline.
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/],
        // Runtime caching for assets the precache doesn't own (third-
        // party origins + Supabase Storage public URLs). Cuts repeat
        // network roundtrips on warm visits and gives a soft offline
        // experience for previously-seen photos / logos.
        runtimeCaching: [
          {
            // Hashed chunks left out of the precache (globIgnores). A
            // hashed URL never changes content, so the first online load
            // is kept for offline use. Never store an HTML page served
            // under a chunk URL (an SPA fallback), only real files.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fh-lazy-assets',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  cacheWillUpdate: async ({ response }) =>
                    response && !(response.headers.get('content-type') || '').includes('text/html') ? response : null,
                },
              ],
            },
          },
          {
            // Google Fonts stylesheet — cache the CSS aggressively;
            // it points to versioned woff2 files that get their own
            // cache below.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Google Fonts woff2 files — never change at a given URL,
            // safe to cache for a year.
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Supabase Storage public-bucket URLs (job photos, logos).
            // Stale-while-revalidate so the user sees a fast hit from
            // cache while the SW refreshes in the background. Capped
            // at 7 days so deleted-then-re-uploaded photos don't stay
            // stale forever.
            urlPattern: /\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-storage-public',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
              // 200 only — status 0 (opaque) can wrap an error response
              // and pin it in cache for 7 days. Supabase Storage serves
              // proper CORS headers so responses are never opaque here.
              // (Google Fonts above keeps [0, 200]: gstatic requests are
              // legitimately opaque in no-cors mode — official Workbox
              // recipe.)
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      includeAssets: ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        // Stable identity across installs. Without `id`, Chrome treats
        // the install as a brand-new app every time the start_url path
        // changes (e.g. when a user shares a deep-link), and may re-prompt
        // to install something the user already has installed. Pinning
        // id='/' anchors the identity to the root regardless of how the
        // user landed on the page.
        id: '/',
        name: 'Fieldhorse',
        short_name: 'Fieldhorse',
        description: 'Contractor field operations',
        // Onyx, the dark --v3-bg. Matches the theme-color meta in
        // index.html and THEME_COLOR.dark in ThemeContext.tsx, so the
        // splash, the status bar and the first painted frame agree.
        theme_color: '#141414',
        background_color: '#141414',
        display: 'standalone',
        // No orientation lock: the app has tablet and desktop layouts at
        // 900px and up, which a portrait lock kept Android tablets from
        // reaching in landscape.
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vite's dynamic-import preload helper is a virtual module the
          // entry imports statically (it wraps all 33 lazy `import()`s) and
          // that ~20 lazy chunks also import. Rollup was colocating it into
          // vendor-jspdf, so the entry's static import of the helper dragged
          // the whole 391KB jspdf chunk onto the modulepreload critical
          // path. Pin the helper to its own tiny chunk BEFORE the
          // node_modules guard (the virtual id isn't under node_modules).
          if (id.includes('vite/preload-helper')) return 'vendor-preload-helper'
          if (!id.includes('node_modules')) return undefined
          // Tiny shared class-name utils (clsx, tailwind-merge, cva) are
          // imported by eager UI (Home / Login / AppShell), so the entry
          // statically references whatever chunk they land in. Pin them to
          // their own micro-chunk FIRST so Rollup can't colocate them with
          // a heavyweight vendor (charts / jspdf) and thereby drag that
          // whole chunk onto the modulepreloaded critical path.
          if (id.includes('clsx') || id.includes('tailwind-merge') || id.includes('class-variance-authority')) return 'vendor-utils'
          if (id.includes('jspdf-autotable')) return 'vendor-pdf-table'
          if (id.includes('jspdf')) return 'vendor-jspdf'
          if (id.includes('html2canvas')) return 'vendor-html2canvas'
          if (id.includes('dompurify')) return 'vendor-dompurify'
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
          if (id.includes('framer-motion')) return 'vendor-motion'
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('@radix-ui') || id.includes('cmdk') || id.includes('vaul')) return 'vendor-ui'
          // Lazy-only libraries whose package name contains "react" — MUST
          // be matched BEFORE the generic 'react' catch-all below, or they
          // fall into the eagerly-modulepreloaded vendor-react chunk and
          // defeat the lazy Calendar (react-day-picker) / any lazy table
          // view (@tanstack/react-table).
          if (id.includes('react-day-picker')) return 'vendor-daypicker'
          if (id.includes('@tanstack/react-table')) return 'vendor-table'
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom') || id.includes('scheduler')) return 'vendor-react'
          return undefined
        }
      }
    }
  },
  server: { port: 5173, host: true }
})
