// Google Maps JavaScript API loader.
//
// The script tag is injected once and shared: React strict mode double-mounts
// components in development, and loading the SDK twice throws a console error
// and leaks a second copy of the library.

export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

/** Whether a real map can be rendered, or the fallback should be used. */
export const isGoogleMapsConfigured = GOOGLE_MAPS_API_KEY.length > 0;

const CALLBACK_NAME = '__qlessGoogleMapsReady';
const SCRIPT_ID = 'qless-google-maps';

let loadPromise: Promise<void> | null = null;

declare global {
  interface Window {
    google?: typeof google;
    [CALLBACK_NAME]?: () => void;
  }
}

/**
 * Loads the SDK, resolving immediately if it is already present.
 *
 * Rejects rather than hanging when the key is missing or the script fails, so
 * callers can fall back to the visual map instead of showing a blank frame.
 */
export function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only load in the browser'));
  }
  if (!isGoogleMapsConfigured) {
    return Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set'));
  }
  if (loadPromise) return loadPromise;
  // NOTE: the presence of `window.google.maps` is NOT sufficient to start using
  // the SDK. With `loading=async` the core object appears before the optional
  // libraries finish, so `google.maps.marker` can still be undefined here. Every
  // path below therefore ends at `ensureLibraries()`.
  if (window.google?.maps) {
    loadPromise = ensureLibraries();
    return loadPromise;
  }

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')));
      return;
    }

    window[CALLBACK_NAME] = () => {
      resolve();
      delete window[CALLBACK_NAME];
    };

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    // `loading=async` is what Google now recommends; `marker` gives us the
    // AdvancedMarkerElement used for the station pins.
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}` +
      `&libraries=marker,geocoding&loading=async&callback=${CALLBACK_NAME}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      // Cleared so a later attempt can retry rather than reusing a rejection.
      loadPromise = null;
      reject(new Error('Google Maps failed to load — check the API key and its restrictions'));
    };

    document.head.appendChild(script);
  })
    .then(ensureLibraries)
    .catch((err) => {
      // Clear the cache so a later mount retries instead of replaying this
      // rejection forever.
      loadPromise = null;
      throw err;
    });

  return loadPromise;
}

/**
 * Waits for the optional libraries the map actually uses.
 *
 * `importLibrary` is the supported way to await a library under `loading=async`;
 * it resolves immediately once the library is present, so calling it repeatedly
 * is cheap. Without this, `google.maps.marker` is undefined at first render and
 * constructing an AdvancedMarkerElement throws.
 */
async function ensureLibraries(): Promise<void> {
  const maps = window.google?.maps;
  if (!maps) throw new Error('Google Maps failed to initialise');

  if (typeof maps.importLibrary === 'function') {
    // `geocoding` backs the header's place name; it must be awaited for the same
    // reason as `marker` — under loading=async the namespace is otherwise absent.
    await Promise.all([maps.importLibrary('marker'), maps.importLibrary('geocoding')]);
    return;
  }

  // Older SDK builds have no importLibrary; the callback already guarantees the
  // requested libraries are attached by then.
  if (!maps.marker) {
    throw new Error('Google Maps "marker" library is unavailable');
  }
}
