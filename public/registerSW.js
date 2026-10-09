// Service worker registration. vite-plugin-pwa injects
// <script src="/registerSW.js"> into index.html and, because this file
// exists in public/, ships it instead of generating its own. Keep the
// worker path and scope in step with the VitePWA options in vite.config.js.
//
// Customer document links (/p/:token) do not register. A homeowner who
// opens one proposal should not install the contractor app's service
// worker and download its whole precache in the background. A worker that
// is already installed (the contractor's own device) still controls these
// pages as before.
if ('serviceWorker' in navigator && !/^\/p\//.test(location.pathname)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
  })
}
