import { readJSON, writeJSON } from '@/lib/storage';
import { calculateDistance } from '@/lib/geo';
import { DEFAULT_MAP_CENTER } from '@/lib/api/config';
import { isGoogleMapsConfigured, loadGoogleMaps } from '@/lib/googleMaps';
import { StationService } from './StationService';
import { VisitService } from './VisitService';
import type { Coordinates, LocationErrorReason, PlaceBounds } from '@/types';

const KEY = 'qless.location.manual';

// Default reference point used before the user's location is known.
export const DEFAULT_COORDS: Coordinates = DEFAULT_MAP_CENTER;

export type LocationResult =
  | { status: 'granted'; coords: Coordinates; label: string }
  | { status: 'denied' }
  | { status: 'error'; reason: LocationErrorReason; message: string };

const ERROR_MESSAGES: Record<LocationErrorReason, string> = {
  'insecure-context':
    'Location needs a secure connection. Open the app on http://localhost:3000 or over HTTPS.',
  unsupported: 'This browser does not support location.',
  timeout: 'Getting your location took too long. Check that GPS is on, then try again.',
  unavailable:
    'Your device could not determine a location right now. Try again, or set your area manually.',
};

function fail(reason: LocationErrorReason): LocationResult {
  return { status: 'error', reason, message: ERROR_MESSAGES[reason] };
}

/**
 * Geolocation is gated behind a secure context. `next dev -H 0.0.0.0` makes the
 * app reachable at http://<lan-ip>:3000, where browsers strip `navigator.
 * geolocation` or reject every call — the single most common reason "Enable
 * Location" appears broken in development.
 */
function isSecureContext(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Turns coordinates into a short place name for the header.
 *
 * Best-effort by design: the header must never wait on, or be broken by, a
 * geocoding failure, so every error path falls back to the rounded coordinates
 * rather than throwing or leaving a generic placeholder.
 */
export async function describeCoords(coords: Coordinates): Promise<string> {
  const fallback = `${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}`;
  if (!isGoogleMapsConfigured) return fallback;

  try {
    await loadGoogleMaps();
    const geocoder = new google.maps.Geocoder();
    const { results } = await geocoder.geocode({
      location: { lat: coords.lat, lng: coords.lng },
    });
    if (!results.length) return fallback;

    // Prefer the neighbourhood/suburb over the full postal address: the header
    // is a narrow chip, and "Baner" is more useful there than 12 comma-separated
    // address parts.
    const preferred = ['sublocality', 'neighborhood', 'locality', 'postal_town'];
    for (const type of preferred) {
      const hit = results.find((r) => r.types.includes(type));
      const name = hit?.address_components.find((c) => c.types.includes(type))?.long_name;
      if (name) return name;
    }
    return results[0].formatted_address.split(',')[0] || fallback;
  } catch {
    return fallback;
  }
}

export interface PlaceResult {
  /** Short label for the header chip, e.g. "Baner". */
  label: string;
  /** Full address for disambiguating similar names in the results list. */
  description: string;
  coords: Coordinates;
  /**
   * The place's own extent, used to outline the chosen area on the map. Null for
   * results Google returns without a viewport (rare, e.g. a bare coordinate).
   */
  bounds: PlaceBounds | null;
}

/**
 * Resolves a typed place — city, area or PIN code — to coordinates.
 *
 * Uses the Geocoder rather than Places Autocomplete: it is already loaded for
 * the header's reverse lookup, it accepts PIN codes directly, and it returns
 * coordinates in the same call, so picking a result needs no second request.
 *
 * Biased to India via `componentRestrictions` so "411057" and short area names
 * resolve locally instead of matching a same-named place abroad.
 */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2 || !isGoogleMapsConfigured) return [];

  try {
    await loadGoogleMaps();
    const geocoder = new google.maps.Geocoder();
    const { results } = await geocoder.geocode({
      address: trimmed,
      componentRestrictions: { country: 'IN' },
    });

    return results.slice(0, 6).map((r) => {
      const short =
        r.address_components.find((c) =>
          c.types.some((t) =>
            ['sublocality', 'neighborhood', 'locality', 'postal_town'].includes(t),
          ),
        )?.long_name ??
        r.formatted_address.split(',')[0];

      // `viewport` is the recommended display extent and is present on
      // essentially every geocoder result; `bounds` is the tighter true extent
      // but is often absent, so viewport is the reliable primary.
      const box = r.geometry.viewport ?? r.geometry.bounds ?? null;

      return {
        label: short,
        description: r.formatted_address,
        coords: { lat: r.geometry.location.lat(), lng: r.geometry.location.lng() },
        bounds: box
          ? {
              north: box.getNorthEast().lat(),
              east: box.getNorthEast().lng(),
              south: box.getSouthWest().lat(),
              west: box.getSouthWest().lng(),
            }
          : null,
      };
    });
  } catch {
    // A failed lookup yields no suggestions; the caller shows an empty state
    // rather than surfacing a provider error the user cannot act on.
    return [];
  }
}

// LocationService — wraps the browser Geolocation API and (mock) verification.
export const LocationService = {
  describeCoords,
  searchPlaces,

  // Distance helper exposed on the service per the app's service contract.
  calculateDistance,

  async getCurrentLocation(): Promise<LocationResult> {
    return this.getCurrentPosition();
  },

  /**
   * Reads the stored permission decision WITHOUT prompting.
   *
   * Lets the app re-acquire a real fix on load for users who already granted
   * access, instead of silently falling back to a default city until the user
   * happens to press "Enable Location" again. Returns null where the
   * Permissions API is unavailable (older Safari), so callers stay prompt-free.
   */
  async getPermissionState(): Promise<PermissionState | null> {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      return status.state;
    } catch {
      return null;
    }
  },

  /**
   * One-shot position read.
   *
   * Tries a fast, cached, low-accuracy fix first, then retries once with high
   * accuracy and no cache. Desktop browsers routinely fail the first attempt
   * (no recent fix to hand back), and a single 8s attempt made that look like a
   * permission denial. Only a real PERMISSION_DENIED returns 'denied'; every
   * other failure is reported as itself so the UI can explain it.
   */
  async getCurrentPosition(): Promise<LocationResult> {
    if (typeof navigator === 'undefined' || !navigator.geolocation)
      return fail('unsupported');

    if (!isSecureContext()) return fail('insecure-context');

    const attempt = (options: PositionOptions): Promise<LocationResult> =>
      new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              status: 'granted',
              coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
              label: 'Current location',
            }),
          (err) => {
            if (err.code === err.PERMISSION_DENIED) resolve({ status: 'denied' });
            else if (err.code === err.TIMEOUT) resolve(fail('timeout'));
            else resolve(fail('unavailable'));
          },
          options,
        );
      });

    const first = await attempt({
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 60000,
    });

    // A denial is final — re-asking cannot change it and only wastes time.
    if (first.status === 'granted' || first.status === 'denied') return first;

    return attempt({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  },

  /**
   * Continuous position updates via watchPosition.
   *
   * Returns a stop function; callers MUST call it on unmount, since an
   * un-cleared watch keeps the GPS radio active and drains the battery long
   * after the user has left the map.
   */
  watchPosition(
    onUpdate: (coords: Coordinates, accuracyM: number) => void,
    onError?: (reason: 'denied' | 'unavailable' | 'timeout') => void,
  ): () => void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onError?.('unavailable');
      return () => undefined;
    }

    const id = navigator.geolocation.watchPosition(
      (pos) =>
        onUpdate(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          pos.coords.accuracy,
        ),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) onError?.('denied');
        else if (err.code === err.TIMEOUT) onError?.('timeout');
        else onError?.('unavailable');
      },
      {
        // High accuracy matters here: the geofence for "I'm Here" is 200 m.
        enableHighAccuracy: true,
        timeout: 15000,
        // Accept a slightly stale fix rather than blocking on a fresh one.
        maximumAge: 10000,
      },
    );

    return () => navigator.geolocation.clearWatch(id);
  },

  setManualLocation(
    label: string,
    coords: Coordinates | null,
    bounds: PlaceBounds | null = null,
  ): void {
    writeJSON(KEY, { label, coords, bounds });
  },

  getManualLocation(): {
    label: string;
    coords: Coordinates | null;
    bounds?: PlaceBounds | null;
  } | null {
    return readJSON<{
      label: string;
      coords: Coordinates | null;
      bounds?: PlaceBounds | null;
    } | null>(KEY, null);
  },

  /**
   * Server-side proximity check.
   *
   * Reads the device's real position and lets the BACKEND decide whether it is
   * close enough — the geofence is enforced there, so there is nothing to fake
   * here. A successful check also opens a StationVisit, which is what the
   * "I'm Here" flow needs next.
   */
  async verifyNearby(
    stationId: string,
  ): Promise<{ nearby: boolean; stationName: string; visitId: string | null }> {
    const [position, station] = await Promise.all([
      this.getCurrentPosition(),
      StationService.getStation(stationId),
    ]);

    const stationName = station?.name ?? 'this station';

    if (position.status !== 'granted') {
      return { nearby: false, stationName, visitId: null };
    }

    const result = await VisitService.checkIn(stationId, position.coords);

    return {
      nearby: result.status === 'checked-in',
      stationName,
      visitId: result.status === 'checked-in' ? result.visit.id : null,
    };
  },
};
