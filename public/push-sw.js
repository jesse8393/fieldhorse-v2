// public/push-sw.js
//
// Web-push handlers, importScripts'd into the generated Workbox service
// worker (see vite.config.js → VitePWA.workbox.importScripts). Payloads
// are JSON: { title, body, link } — produced by netlify/functions/lib/push.js.

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* non-JSON push */ }
  const title = data.title || 'Fieldhorse'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { link: data.link || '/' },
    // Collapse repeat pings for the same thing (same tag replaces).
    tag: data.tag || undefined
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Focus an existing app window and route it; otherwise open one.
      for (const w of wins) {
        if ('focus' in w) {
          w.focus()
          if ('navigate' in w) w.navigate(link)
          return
        }
      }
      return self.clients.openWindow(link)
    })
  )
})
