const V = 'sp-v20';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.webmanifest'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin || u.pathname.startsWith('/api/') || req.headers.has('range')) return;
  e.respondWith(fetch(req).then((response) => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      e.waitUntil(caches.open(V).then((c) => c.put(req, copy)).catch(() => {}));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') return (await caches.match('/')) || Response.error();
    return Response.error();
  }));
});

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Predictx', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Predictx', {
    body: m.body || '', tag: m.tag, icon: '/icon-192.png', badge: '/icon-192.png',
    data: { url: m.url || '/' }, renotify: false
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let target = '/';
  try {
    const candidate = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
    if (candidate.origin === self.location.origin) target = candidate.pathname + candidate.search + candidate.hash;
  } catch { /* keep the safe home-page fallback */ }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin) {
        if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); }
      }
    }
    return self.clients.openWindow(target);
  }));
});
