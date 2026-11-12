const V = 'sp-v15';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(V).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('/'))));
});

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Predictx', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Predictx', { body: m.body || '', tag: m.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: m.url || '/' }, renotify: false }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
