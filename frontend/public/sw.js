// QLess service worker — offline shell + push notification abstraction.
// Strategy: network-first everywhere (so fresh assets always win), with the
// cached offline shell used only when a navigation fails while offline.
const CACHE = 'qless-shell-v3';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE, '/manifest.webmanifest']))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Only handle top-level navigations; let everything else hit the network
  // untouched so build assets are never served stale.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
  }
});

// Push from the backend. Payload shape:
//   { title, body, data: { url: "/stations/<id>", tag: "station-<id>", ... } }
self.addEventListener('push', (event) => {
  let payload = { title: 'QLess', body: 'A station now matches your alert.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    /* ignore malformed payloads */
  }

  const data = payload.data || {};
  // The backend's deep link is /stations/<id>; the app route is /app/station/<id>.
  const stationId = data.stationId;
  const url = stationId ? '/app/station/' + stationId : '/app/alerts';

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      // Collapses repeat alerts for one station into a single notification.
      tag: data.tag || 'qless',
      renotify: true,
      data: { ...data, url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || '/app/alerts';

  // Focus an existing tab and navigate it rather than piling up windows.
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            if ('navigate' in client) client.navigate(target).catch(() => {});
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
