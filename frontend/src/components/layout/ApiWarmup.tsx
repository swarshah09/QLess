'use client';

import { useEffect } from 'react';
import { API_BASE_URL } from '@/lib/api/config';

let sent = false;

// Free-tier hosting spins the backend down when idle, and the first request
// then waits for it to boot. That request used to be the station query, which
// only starts once geolocation resolves; pinging the dependency-free health
// endpoint on load starts the wake-up while the user is still reading the
// landing page or answering the location prompt. It also opens the
// credentialed connection the API client will reuse. Once per page load.
export function ApiWarmup() {
  useEffect(() => {
    if (sent) return;
    sent = true;
    fetch(`${API_BASE_URL}/health`, { credentials: 'include', cache: 'no-store' }).catch(
      () => undefined,
    );
  }, []);
  return null;
}
