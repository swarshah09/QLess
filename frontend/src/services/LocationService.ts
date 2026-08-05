import { MOCK_STATIONS } from '@/mocks';
import { delay, readJSON, writeJSON } from '@/lib/storage';
import type { Coordinates } from '@/types';

const KEY = 'qless.location.manual';

// Default map center (Ahmedabad) used when no location is available.
export const DEFAULT_COORDS: Coordinates = { lat: 23.0225, lng: 72.5714 };

export type LocationResult =
  | { status: 'granted'; coords: Coordinates; label: string }
  | { status: 'denied' }
  | { status: 'unsupported' };

// LocationService — wraps the browser Geolocation API and (mock) verification.
export const LocationService = {
  async getCurrentPosition(): Promise<LocationResult> {
    if (typeof navigator === 'undefined' || !navigator.geolocation)
      return { status: 'unsupported' };

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            status: 'granted',
            coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
            label: 'Current location',
          });
        },
        () => resolve({ status: 'denied' }),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
      );
    });
  },

  setManualLocation(label: string, coords: Coordinates | null): void {
    writeJSON(KEY, { label, coords });
  },

  getManualLocation(): { label: string; coords: Coordinates | null } | null {
    return readJSON<{ label: string; coords: Coordinates | null } | null>(
      KEY,
      null,
    );
  },

  // Mock proximity check — pretends the user is near the station ~70% of time,
  // but always "near" for the demo's primary station so flows can be tested.
  async verifyNearby(stationId: string): Promise<{ nearby: boolean; stationName: string }> {
    const station = MOCK_STATIONS.find((s) => s.id === stationId);
    const nearby = stationId === 'shree-cng' ? true : Math.random() > 0.35;
    return delay(
      { nearby, stationName: station?.name ?? 'this station' },
      900,
    );
  },
};
