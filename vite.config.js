import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
        cleanupOutdatedCaches: true
      },
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
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
        theme_color: '#141414',
        background_color: '#141414',
        display: 'standalone',
        orientation: 'portrait',
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
  server: { port: 5173, host: true }
})
