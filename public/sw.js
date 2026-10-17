// MediQueue service worker: only shows token alerts and opens the tracking page when one is
// tapped. Android browsers cannot create notifications from a page without one. No caching, no
// offline mode, no push subscription.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin)
  if (url.origin !== self.location.origin) return
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).pathname === url.pathname)
      return open ? open.focus() : self.clients.openWindow(url.href)
    }),
  )
})
