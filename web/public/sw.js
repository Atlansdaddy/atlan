/* ATLAN push-only service worker.
   HARD RULE: NO fetch handler. Ever. A SW that never intercepts requests can
   never serve stale content (John's stale-SW landmine) — it exists solely to
   surface push notifications from the fleet. Doctor asserts this file stays
   fetch-free; adding caching here is a bug, not a feature. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { /* non-JSON push — show generic */ }
  e.waitUntil(self.registration.showNotification(d.title || 'Atlan', {
    body: d.body || '',
    icon: '/img/atlan-bot.svg',
    badge: '/img/atlan-bot.svg',
    tag: d.tag || 'atlan',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(
    (cs) => (cs.length ? cs[0].focus() : self.clients.openWindow('/')),
  ));
});
