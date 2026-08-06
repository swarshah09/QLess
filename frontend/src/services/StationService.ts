import { MOCK_STATIONS } from '@/mocks';
import { delay } from '@/lib/storage';
import { distanceFrom } from '@/lib/geo';
import { getFreshness, minutesSince, queueUpperBound } from '@/lib/status';
import { DEFAULT_COORDS } from './LocationService';
import type { Coordinates, NearbyQuery, Station, StationFilters, SortKey } from '@/types';

// Recompute the distance of a station from a reference point (Haversine).
function withDistance(s: Station, origin: Coordinates): Station {
  return { ...s, distanceKm: distanceFrom(origin, s.lat, s.lng) };
}

function applyFilters(stations: Station[], f?: StationFilters): Station[] {
  if (!f) return stations;
  return stations.filter((s) => {
    if (f.availableOnly && s.availability !== 'AVAILABLE') return false;
    if (f.maxQueue != null) {
      const q = queueUpperBound(s.queue);
      if (q == null || q > f.maxQueue) return false;
    }
    if (f.maxWaitMinutes != null) {
      if (!s.wait || s.wait.maxMinutes > f.maxWaitMinutes) return false;
    }
    if (f.normalPressureOnly && s.pressure.status !== 'NORMAL') return false;
    if (f.maxDistanceKm != null && (s.distanceKm ?? Infinity) > f.maxDistanceKm)
      return false;
    return true;
  });
}

function applySort(stations: Station[], sort: SortKey): Station[] {
  const arr = [...stations];
  switch (sort) {
    case 'wait':
      return arr.sort(
        (a, b) => (a.wait?.maxMinutes ?? 9999) - (b.wait?.maxMinutes ?? 9999),
      );
    case 'queue':
      return arr.sort(
        (a, b) => (queueUpperBound(a.queue) ?? 999) - (queueUpperBound(b.queue) ?? 999),
      );
    case 'updated':
      return arr.sort(
        (a, b) => minutesSince(a.lastUpdated) - minutesSince(b.lastUpdated),
      );
    case 'nearest':
    default:
      return arr.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
  }
}

// StationService — the single gateway between UI and station data. Swapping
// the mock body for real API calls should not require any UI changes.
export const StationService = {
  async getNearbyStations(query: NearbyQuery = {}): Promise<Station[]> {
    const origin = query.origin ?? DEFAULT_COORDS;
    const sort = query.sort ?? 'nearest'; // nearest-first is the default
    const withDist = MOCK_STATIONS.map((s) => withDistance(s, origin));
    const filtered = applyFilters(withDist, query.filters);
    return delay(applySort(filtered, sort), 500);
  },

  async getStation(id: string, origin?: Coordinates): Promise<Station | null> {
    const found = MOCK_STATIONS.find((s) => s.id === id);
    if (!found) return delay(null, 300);
    return delay(withDistance(found, origin ?? DEFAULT_COORDS), 350);
  },

  async getStationsByIds(ids: string[], origin?: Coordinates): Promise<Station[]> {
    const o = origin ?? DEFAULT_COORDS;
    const results = MOCK_STATIONS.filter((s) => ids.includes(s.id)).map((s) =>
      withDistance(s, o),
    );
    return delay(results, 300);
  },

  // "Better options nearby" — available alternatives with a shorter queue.
  async getBetterOptions(id: string, origin?: Coordinates): Promise<Station[]> {
    const o = origin ?? DEFAULT_COORDS;
    const base = MOCK_STATIONS.find((s) => s.id === id);
    if (!base) return delay([], 200);
    const baseQ = queueUpperBound(base.queue) ?? 99;
    const options = MOCK_STATIONS.filter((s) => {
      if (s.id === id) return false;
      if (s.availability !== 'AVAILABLE') return false;
      if (getFreshness(s.lastUpdated) === 'STALE') return false;
      const q = queueUpperBound(s.queue) ?? 99;
      return q < baseQ;
    })
      .map((s) => withDistance(s, o))
      .sort((a, b) => (a.wait?.maxMinutes ?? 999) - (b.wait?.maxMinutes ?? 999))
      .slice(0, 2);
    return delay(options, 300);
  },
};
