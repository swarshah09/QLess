import { apiRequest } from '@/lib/api/client';
import { NEARBY_RADIUS_M } from '@/lib/api/config';
import { mapStation, type ApiStation } from '@/lib/api/mappers';
import { queueUpperBound } from '@/lib/status';
import { DEFAULT_COORDS } from './LocationService';
import type { Coordinates, NearbyQuery, SortKey, Station, StationFilters } from '@/types';

// StationService — the single gateway between UI and station data.

/** Frontend sort key → the backend's `sort` parameter. */
const SORT_MAP: Record<SortKey, string> = {
  nearest: 'distance',
  wait: 'wait',
  queue: 'queue',
  updated: 'recent',
};

/**
 * Filters the backend can evaluate server-side. `normalPressureOnly` and
 * `maxDistanceKm` have no direct equivalent, so they stay client-side below.
 */
function toBackendFilters(filters?: StationFilters) {
  if (!filters) return {};
  return {
    availability: filters.availableOnly ? 'AVAILABLE' : undefined,
    maxQueue: filters.maxQueue,
    maxWait: filters.maxWaitMinutes,
  };
}

function applyClientFilters(stations: Station[], filters?: StationFilters): Station[] {
  if (!filters) return stations;
  return stations.filter((s) => {
    if (filters.normalPressureOnly && s.pressure.status !== 'NORMAL') return false;
    if (filters.maxDistanceKm != null && (s.distanceKm ?? Infinity) > filters.maxDistanceKm) {
      return false;
    }
    return true;
  });
}

export interface Recommendation {
  recommendedStationId: string | null;
  nearestStationId: string | null;
  differsFromNearest: boolean;
  savingMinutes: number | null;
  reason: string | null;
  alternatives: Array<{
    stationId: string;
    name: string;
    distanceKm: number | null;
    savingMinutes: number;
  }>;
}

export const StationService = {
  /**
   * Nearby stations. The backend returns them NEAREST FIRST by default and
   * applies the requested sort itself — the order is never re-derived here.
   */
  async getNearbyStations(query: NearbyQuery = {}): Promise<Station[]> {
    const origin = query.origin ?? DEFAULT_COORDS;
    const sort = query.sort ?? 'nearest';

    const result = await apiRequest<{ stations: ApiStation[] }>('/stations/nearby', {
      auth: false, // Guest-accessible; the token is attached when present.
      query: {
        latitude: origin.lat,
        longitude: origin.lng,
        radius: NEARBY_RADIUS_M,
        sort: SORT_MAP[sort],
        limit: 50,
        ...toBackendFilters(query.filters),
      },
    });

    return applyClientFilters(result.stations.map(mapStation), query.filters);
  },

  async getStation(id: string, origin?: Coordinates): Promise<Station | null> {
    const o = origin ?? DEFAULT_COORDS;
    try {
      const result = await apiRequest<{ station: ApiStation }>(`/stations/${id}`, {
        auth: false,
        query: { latitude: o.lat, longitude: o.lng },
      });
      return mapStation(result.station);
    } catch {
      return null;
    }
  },

  /**
   * Several stations by id. Resolved from one nearby query rather than N
   * requests, falling back to individual fetches for anything outside the
   * radius (a saved station can be far away).
   */
  async getStationsByIds(ids: string[], origin?: Coordinates): Promise<Station[]> {
    if (ids.length === 0) return [];
    const o = origin ?? DEFAULT_COORDS;

    const nearby = await this.getNearbyStations({ origin: o });
    const found = new Map(nearby.filter((s) => ids.includes(s.id)).map((s) => [s.id, s]));

    const missing = ids.filter((id) => !found.has(id));
    const fetched = await Promise.all(missing.map((id) => this.getStation(id, o)));

    for (const station of fetched) {
      if (station) found.set(station.id, station);
    }

    // Preserve the caller's ordering.
    return ids.map((id) => found.get(id)).filter((s): s is Station => s !== undefined);
  },

  /**
   * "Better options nearby" — backed by the recommendation endpoint, which
   * ranks on travel time plus expected wait rather than queue alone.
   */
  async getBetterOptions(id: string, origin?: Coordinates): Promise<Station[]> {
    const o = origin ?? DEFAULT_COORDS;

    try {
      const result = await apiRequest<{
        stations: ApiStation[];
        recommendation: Recommendation;
      }>('/stations/recommendations', {
        auth: false,
        query: { latitude: o.lat, longitude: o.lng, radius: NEARBY_RADIUS_M, limit: 20 },
      });

      const byId = new Map(result.stations.map((s) => [s.id, mapStation(s)]));

      const options = result.recommendation.alternatives
        .filter((alternative) => alternative.stationId !== id)
        // Only genuinely faster options are worth surfacing.
        .filter((alternative) => alternative.savingMinutes > 0)
        .map((alternative) => byId.get(alternative.stationId))
        .filter((s): s is Station => s !== undefined);

      // The recommended station itself belongs here when it is not the one
      // being viewed and was not already listed as an alternative.
      const recommendedId = result.recommendation.recommendedStationId;
      if (recommendedId && recommendedId !== id && !options.some((s) => s.id === recommendedId)) {
        const recommended = byId.get(recommendedId);
        if (recommended) options.unshift(recommended);
      }

      return options.slice(0, 2);
    } catch {
      return [];
    }
  },

  /** Full recommendation payload, including the nearest-first station list. */
  async getRecommendations(origin?: Coordinates): Promise<{
    stations: Station[];
    recommendation: Recommendation;
  }> {
    const o = origin ?? DEFAULT_COORDS;
    const result = await apiRequest<{
      stations: ApiStation[];
      recommendation: Recommendation;
    }>('/stations/recommendations', {
      auth: false,
      query: { latitude: o.lat, longitude: o.lng, radius: NEARBY_RADIUS_M, limit: 50 },
    });

    return {
      stations: result.stations.map(mapStation),
      recommendation: result.recommendation,
    };
  },

  /** Exposed for callers that need the queue bound without importing lib/status. */
  queueUpperBound,
};
