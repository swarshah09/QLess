import { Availability, type StationStatus } from '@prisma/client';
import { GEO } from '../config/constants';
import { AppError } from '../errors/AppError';
import { stationGeoQuery, type NearbyFilters } from '../repositories/geo';
import { prisma } from '../config/prisma';
import { stationRepository, type StationRecord } from '../repositories/station.repository';
import { stationStatusRepository } from '../repositories/stationStatus.repository';
import { savedStationRepository } from '../repositories/savedStation.repository';
import { supplyEventRepository } from '../repositories/supplyEvent.repository';
import { stationStateService } from './stationState.service';
import type { AuthenticatedUser } from '../types/auth';
import { haversineDistanceM, metresToKm, type Coordinates } from '../utils/geo';
import { labelForBucket } from '../utils/queue';

/**
 * Station discovery and presentation.
 *
 * The default ordering is NEAREST FIRST and it is applied explicitly on every
 * path — no query ever relies on database insertion order.
 */

export type StationSort = 'distance' | 'wait' | 'queue' | 'recent';

/**
 * Upper bound on how many stations inside the radius are considered before
 * sorting. Well above any realistic station density for a 50 km radius, so it
 * only exists to stop a pathological query loading the whole table.
 */
const MAX_NEARBY_CANDIDATES = 500;

export interface NearbyParams {
  latitude: number;
  longitude: number;
  radiusM?: number;
  sort?: StationSort;
  limit: number;
  filters: Omit<NearbyFilters, 'includeInactive'>;
  viewer?: AuthenticatedUser;
}

/** Client-facing shape combining a station, its computed status and distance. */
export interface StationView {
  id: string;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number;
  longitude: number;
  active: boolean;
  numberOfDispensers: number;
  operatingHours: unknown;
  /** Null when the caller supplied no coordinates. */
  distanceKm: number | null;
  distanceM: number | null;
  saved: boolean;
  status: {
    availability: Availability;
    queue: { min: number | null; max: number | null; bucket: string; label: string };
    wait: { min: number | null; max: number | null };
    pressure: {
      value: number | null;
      unit: string;
      status: string;
      /** Echoed so clients can explain a LOW reading without guessing. */
      thresholds: { low: number | null; normal: number | null };
    };
    activeDispensers: number | null;
    confidence: number;
    freshness: string;
    computedAt: Date | null;
    lastOperatorUpdateAt: Date | null;
    lastUserUpdateAt: Date | null;
  };
}

/**
 * The status shown when a station has never been reported on.
 *
 * The pressure thresholds are still echoed: they are configuration belonging to
 * the station itself, not an observation, so they are known even when nothing
 * has been reported.
 */
function unknownStatus(station: StationRecord): StationView['status'] {
  return {
    availability: Availability.UNKNOWN,
    // Null bounds, not zero — nobody has told us anything about this queue.
    queue: { min: null, max: null, bucket: 'UNKNOWN', label: 'Unknown' },
    wait: { min: null, max: null },
    pressure: {
      value: null,
      unit: station.defaultPressureUnit,
      status: 'UNKNOWN',
      thresholds: {
        low: station.pressureThresholdLow,
        normal: station.pressureThresholdNormal,
      },
    },
    activeDispensers: null,
    confidence: 0,
    freshness: 'UNKNOWN',
    computedAt: null,
    lastOperatorUpdateAt: null,
    lastUserUpdateAt: null,
  };
}

function toStationView(
  station: StationRecord,
  status: StationStatus | null,
  distanceM: number | null,
  saved: boolean,
): StationView {
  return {
    id: station.id,
    name: station.name,
    address: station.address,
    city: station.city,
    state: station.state,
    pincode: station.pincode,
    latitude: station.latitude,
    longitude: station.longitude,
    active: station.active,
    numberOfDispensers: station.numberOfDispensers,
    operatingHours: station.operatingHours,
    distanceM: distanceM === null ? null : Math.round(distanceM),
    distanceKm: distanceM === null ? null : metresToKm(distanceM),
    saved,
    status: status
      ? {
          availability: status.availability,
          queue: {
            min: status.queueMin,
            max: status.queueMax,
            bucket: status.queueBucket,
            label: labelForBucket(status.queueBucket),
          },
          wait: { min: status.waitMin, max: status.waitMax },
          pressure: {
            value: status.pressureValue,
            unit: status.pressureUnit,
            status: status.pressureStatus,
            // Per-station thresholds, never a global constant.
            thresholds: {
              low: station.pressureThresholdLow,
              normal: station.pressureThresholdNormal,
            },
          },
          activeDispensers: status.activeDispensers,
          confidence: status.confidence,
          freshness: status.freshness,
          computedAt: status.computedAt,
          lastOperatorUpdateAt: status.lastOperatorUpdateAt,
          lastUserUpdateAt: status.lastUserUpdateAt,
        }
      : unknownStatus(station),
  };
}

/**
 * Applies the requested ordering.
 *
 * Every non-distance sort falls back to distance for ties, and stations with
 * no data sort last rather than first — an unknown wait is not a short wait.
 */
function sortViews(views: StationView[], sort: StationSort): StationView[] {
  const byDistance = (a: StationView, b: StationView) =>
    (a.distanceM ?? Number.MAX_SAFE_INTEGER) - (b.distanceM ?? Number.MAX_SAFE_INTEGER);

  const nullsLast = (value: number | null) => value ?? Number.MAX_SAFE_INTEGER;

  switch (sort) {
    case 'wait':
      return [...views].sort(
        (a, b) =>
          nullsLast(a.status.wait.min) - nullsLast(b.status.wait.min) || byDistance(a, b),
      );
    case 'queue':
      return [...views].sort(
        (a, b) =>
          nullsLast(a.status.queue.min) - nullsLast(b.status.queue.min) || byDistance(a, b),
      );
    case 'recent':
      return [...views].sort((a, b) => {
        const aTime = a.status.computedAt?.getTime() ?? 0;
        const bTime = b.status.computedAt?.getTime() ?? 0;
        return bTime - aTime || byDistance(a, b);
      });
    case 'distance':
    default:
      return [...views].sort(byDistance);
  }
}

/**
 * Re-derives freshness and confidence for the current moment.
 *
 * A status written as LIVE half an hour ago must not still be served as LIVE.
 * Applying this on every read means staleness needs no background job.
 */
function decayed(status: StationStatus | null | undefined): StationStatus | null {
  return status ? stationStateService.decay(status) : null;
}

async function savedIdsFor(viewer?: AuthenticatedUser): Promise<Set<string>> {
  if (!viewer) return new Set();
  return new Set(await savedStationRepository.listStationIds(viewer.id));
}

export const stationDiscoveryService = {
  /**
   * Nearby stations, nearest first by default.
   *
   * Distance is computed for every candidate within the radius and the result
   * is explicitly sorted — the ordering is a product guarantee, not an artefact
   * of how rows happen to come back from PostgreSQL.
   */
  async nearby(params: NearbyParams): Promise<StationView[]> {
    const origin: Coordinates = {
      latitude: params.latitude,
      longitude: params.longitude,
    };
    const radiusM = params.radiusM ?? GEO.defaultSearchRadiusM;

    const matches = await stationGeoQuery.findNearby({
      origin,
      radiusM,
      filters: { ...params.filters, includeInactive: false },
      maxCandidates: MAX_NEARBY_CANDIDATES,
    });

    if (matches.length === 0) return [];

    const stationIds = matches.map((match) => match.stationId);
    const distanceById = new Map(matches.map((m) => [m.stationId, m.distanceM]));

    const [stations, statuses, savedIds] = await Promise.all([
      prisma.station.findMany({
        where: { id: { in: stationIds } },
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          state: true,
          pincode: true,
          latitude: true,
          longitude: true,
          operatingHours: true,
          active: true,
          numberOfDispensers: true,
          pressureThresholdLow: true,
          pressureThresholdNormal: true,
          defaultPressureUnit: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      stationStatusRepository.findManyByStationIds(stationIds),
      savedIdsFor(params.viewer),
    ]);

    const statusByStation = new Map(statuses.map((s) => [s.stationId, s]));

    const views = stations.map((station) =>
      toStationView(
        station,
        decayed(statusByStation.get(station.id)),
        distanceById.get(station.id) ?? null,
        savedIds.has(station.id),
      ),
    );

    // Sort first, then page. Applying the caller's limit before the sort would
    // mean `sort=queue` only reordered the nearest N instead of finding the
    // shortest queues in the radius.
    return sortViews(views, params.sort ?? 'distance').slice(0, params.limit);
  },

  /**
   * Full station detail, including distance when the caller supplies their
   * position. Inactive stations remain visible so clients can say why.
   */
  async detail(
    stationId: string,
    params: { origin?: Coordinates; viewer?: AuthenticatedUser },
  ): Promise<StationView & { openSupplyEvents: unknown[] }> {
    const station = await stationRepository.findById(stationId);
    if (!station) throw AppError.notFound('Station not found');

    const [status, savedIds, openSupplyEvents] = await Promise.all([
      stationStatusRepository.findByStationId(stationId),
      savedIdsFor(params.viewer),
      supplyEventRepository.findOpenForStation(stationId),
    ]);

    const distanceM = params.origin
      ? haversineDistanceM(params.origin, {
          latitude: station.latitude,
          longitude: station.longitude,
        })
      : null;

    return {
      ...toStationView(station, decayed(status), distanceM, savedIds.has(stationId)),
      openSupplyEvents,
    };
  },

  /** Bounds a requested radius to the configured maximum. */
  clampRadius(requested?: number): number {
    if (!requested) return GEO.defaultSearchRadiusM;
    return Math.min(Math.max(requested, 1), GEO.maxSearchRadiusM);
  },
};
