import type { Availability } from '@prisma/client';
import type { Coordinates } from '../../utils/geo';

/**
 * Proximity-search seam.
 *
 * Distance search is deliberately behind an interface rather than inlined into
 * the station repository. The MVP implementation prefilters with a bounding box
 * in SQL and computes exact Haversine distances in Node, which is fine at this
 * data size. Swapping in PostGIS later (`ST_DWithin` on a `geography` column,
 * with a GiST index) means writing a second implementation of this interface
 * and changing the one line that picks it — no service, controller or route
 * changes, and no change to the response shape.
 */

export interface NearbyQuery {
  origin: Coordinates;
  radiusM: number;
  /** Applied inside the query so the radius is not narrowed by later filtering. */
  filters: NearbyFilters;
  /**
   * A safety cap on how many candidates to materialise, NOT the caller's page
   * size. The caller's `limit` is applied after the requested sort, so that
   * `sort=queue&limit=5` yields the five shortest queues in the radius rather
   * than the five nearest stations re-ordered by queue.
   */
  maxCandidates: number;
}

export interface NearbyFilters {
  /** Match any of these availabilities. Empty or absent means no constraint. */
  availability?: Availability[];
  maxQueue?: number;
  maxWaitMinutes?: number;
  /** In bar — comparisons are done against the normalised value. */
  minPressureBar?: number;
  /** Inactive stations are excluded unless explicitly requested. */
  includeInactive?: boolean;
}

/** A station plus its computed distance from the query origin. */
export interface StationWithDistance {
  stationId: string;
  distanceM: number;
}

export interface StationGeoQuery {
  readonly strategy: 'haversine' | 'postgis';
  findNearby(query: NearbyQuery): Promise<StationWithDistance[]>;
}
