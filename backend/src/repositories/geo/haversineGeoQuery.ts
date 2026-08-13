import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { boundingBox, haversineDistanceM } from '../../utils/geo';
import type {
  NearbyFilters,
  NearbyQuery,
  StationGeoQuery,
  StationWithDistance,
} from './stationGeoQuery';

/**
 * Two-stage proximity search.
 *
 * 1. A bounding box in SQL, which the `[latitude, longitude]` index can serve,
 *    cheaply discards everything obviously too far away.
 * 2. Exact Haversine distances in Node for the survivors, then a true radius
 *    filter — the box is a square around a circle, so its corners include
 *    stations up to ~41% further than the radius and must be trimmed.
 *
 * Stage 2 runs over the box, not the whole table, so cost scales with local
 * density rather than station count.
 */
function buildStatusFilter(filters: NearbyFilters): Prisma.StationWhereInput {
  const conditions: Prisma.StationWhereInput[] = [];

  if (filters.availability?.length) {
    conditions.push({ status: { availability: { in: filters.availability } } });
  }

  if (filters.maxQueue !== undefined) {
    // Compare against the LOWER bound: a station reported as "8-15" can still
    // satisfy "at most 10". An unknown queue (null) is excluded rather than
    // treated as 0 — absence of information is not evidence of a short queue.
    conditions.push({ status: { queueMin: { not: null, lte: filters.maxQueue } } });
  }

  if (filters.maxWaitMinutes !== undefined) {
    conditions.push({ status: { waitMin: { not: null, lte: filters.maxWaitMinutes } } });
  }

  if (filters.minPressureBar !== undefined) {
    conditions.push({ status: { pressureValue: { not: null, gte: filters.minPressureBar } } });
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

export const haversineGeoQuery: StationGeoQuery = {
  strategy: 'haversine',

  async findNearby(query: NearbyQuery): Promise<StationWithDistance[]> {
    const box = boundingBox(query.origin, query.radiusM);

    const candidates = await prisma.station.findMany({
      where: {
        ...(query.filters.includeInactive ? {} : { active: true }),
        latitude: { gte: box.minLatitude, lte: box.maxLatitude },
        longitude: { gte: box.minLongitude, lte: box.maxLongitude },
        ...buildStatusFilter(query.filters),
      },
      select: { id: true, latitude: true, longitude: true },
    });

    return candidates
      .map((station) => ({
        stationId: station.id,
        distanceM: haversineDistanceM(query.origin, {
          latitude: station.latitude,
          longitude: station.longitude,
        }),
      }))
      // Trim the bounding box's corners back to a true circle.
      .filter((row) => row.distanceM <= query.radiusM)
      // Sorted by distance here so that, if the candidate cap does bite, it
      // keeps the nearest ones rather than an arbitrary slice.
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, query.maxCandidates);
  },
};
