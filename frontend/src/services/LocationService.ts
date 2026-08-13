import { readJSON, writeJSON } from '@/lib/storage';
import { calculateDistance } from '@/lib/geo';
import { DEFAULT_MAP_CENTER } from '@/lib/api/config';
import { StationService } from './StationService';
import { VisitService } from './VisitService';
import type { Coordinates } from '@/types';

const KEY = 'qless.location.manual';

// Default reference point used before the user's location is known.
export const DEFAULT_COORDS: Coordinates = DEFAULT_MAP_CENTER;

export type LocationResult =
  | { status: 'granted'; coords: Coordinates; label: string }
  | { status: 'denied' }
  | { status: 'unsupported' };

// LocationService — wraps the browser Geolocation API and (mock) verification.
export const LocationService = {
  // Distance helper exposed on the service per the app's service contract.
  calculateDistance,

  async getCurrentLocation(): Promise<LocationResult> {
    return this.getCurrentPosition();
  },

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
