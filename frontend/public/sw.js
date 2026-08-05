// QLess service worker — offline shell + push notification abstraction.
// Strategy: network-first everywhere (so fresh assets always win), with the
// cached offline shell used only when a navigation fails while offline.
const CACHE = 'qless-shell-v2';
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

// Push abstraction — the backend will send payloads later.
self.addEventListener('push', (event) => {
  let data = { title: 'QLess', body: 'A station now matches your alert.' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    /* ignore malformed payloads */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      data,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/app/alerts'));
});
