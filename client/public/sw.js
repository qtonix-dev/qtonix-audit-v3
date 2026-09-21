/* Qtonix push service worker. Receives Web Push and shows OS notifications
   even when no Qtonix tab is open. Clicking focuses/opens the app. */

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Qtonix', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Qtonix';
  const options = {
    body: data.body || '',
    icon: data.icon || '/brand/favicon-192.png',
    badge: '/brand/favicon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/', ...data.data },
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus an existing Qtonix tab if one is open.
    for (const c of all) { if ('focus' in c) { try { await c.focus(); if (c.navigate && url !== '/') { try { await c.navigate(url); } catch {} } return; } catch {} } }
    // Otherwise open a new one.
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
