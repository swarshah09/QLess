// Runtime configuration for the backend connection.
//
// Next.js inlines NEXT_PUBLIC_* at build time, so these must be referenced as
// full literals rather than assembled dynamically.

const rawApi = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

/** REST base, e.g. http://localhost:4000/api/v1 — never has a trailing slash. */
export const API_BASE_URL = rawApi.replace(/\/+$/, '');

/**
 * Socket.IO origin. Defaults to the API origin with the `/api/v1` path
 * stripped, since the gateway is attached to the same HTTP server.
 */
export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? API_BASE_URL.replace(/\/api\/v\d+$/, '');

/**
 * VAPID public key for Web Push. Optional: when absent the app falls back to
 * fetching it from the backend, so a deployment only has to configure it in
 * one place.
 */
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

/** Default map centre when the user has no location yet (Ahmedabad). */
export const DEFAULT_MAP_CENTER = { lat: 23.03, lng: 72.555 };

/**
 * Default search radius in metres for nearby discovery — a typical city span,
 * so results load fast and stay locally relevant without the user having to
 * open the filter sheet. The "Distance" filter lets them widen it up to the
 * backend's cap.
 *
 * Must not exceed the backend's GEO.maxSearchRadiusM (100 km) or the request is
 * rejected by query validation.
 */
export const NEARBY_RADIUS_M = Number(
  process.env.NEXT_PUBLIC_NEARBY_RADIUS_M ?? 20000,
);

export const REALTIME_ENABLED =
  (process.env.NEXT_PUBLIC_REALTIME_ENABLED ?? 'true') !== 'false';
