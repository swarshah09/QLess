'use client';

import { useEffect } from 'react';

// Registers the PWA service worker in production only. In the dev/preview
// server, hashed chunks change constantly, so we unregister any existing
// worker and clear its caches to avoid serving stale assets.
export function ServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const isProd = process.env.NODE_ENV === 'production';

    if (isProd && window.location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    } else {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      });
      if ('caches' in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
    }
  }, []);
  return null;
}
