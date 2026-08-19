'use strict';

const mongoose = require('mongoose');
const Station = require('../models/Station');
const SavedStation = require('../models/SavedStation');
const SupplyEvent = require('../models/SupplyEvent');
const { GEO, RECOMMENDATION } = require('../config/constants');
const { ApiError } = require('../utils/ApiError');
const { haversineDistanceM, metresToKm } = require('../utils/domain');
const stationStatusService = require('./stationStatus.service');
const stationDiscoveryService = require('./stationDiscovery.service');

/**
 * Station discovery and presentation.
 *
 * Nearest-first is the DEFAULT and is always applied explicitly — no response
 * ordering relies on natural document order.
 */

/**
 * Client-facing shape. This is the frontend's contract: `latitude`/`longitude`
 * as plain numbers (not GeoJSON), null-means-unknown queue/wait, and per-station
 * pressure thresholds echoed so a LOW reading can be explained.
 */
function serializeStation(station, { distanceM = null, saved = false, now = new Date() } = {}) {
  const raw = station.status ?? {};
  // Re-derived for *now*, so a stale status is never served as live.
  const status = stationStatusService.decay(raw, now);

  return {
    id: String(station._id),
    name: station.name,
    address: station.address,
    city: station.city ?? null,
    state: station.state ?? null,
    pincode: station.pincode ?? null,
    latitude: station.location?.coordinates?.[1] ?? null,
    longitude: station.location?.coordinates?.[0] ?? null,
    active: station.active,
    numberOfDispensers: station.numberOfDispensers,
    operatingHours: station.operatingHours ?? null,
    distanceM: distanceM === null ? null : Math.round(distanceM),
    distanceKm: distanceM === null ? null : metresToKm(distanceM),
    saved,
    status: {
      availability: status.availability ?? 'UNKNOWN',
      queue: {
        // Null means unknown — clients must never render this as zero.
        min: status.queueMin ?? null,
        max: status.queueMax ?? null,
        bucket: status.queueLabel ?? 'UNKNOWN',
        label: status.queueLabel ?? 'UNKNOWN',
      },
      wait: { min: status.waitMin ?? null, max: status.waitMax ?? null },
      pressure: {
        value: status.pressureValue ?? null,
        unit: status.pressureUnit ?? 'BAR',
        status: status.pressureStatus ?? 'UNKNOWN',
        thresholds: {
          low: station.pressureThresholdLow ?? null,
          normal: station.pressureThresholdNormal ?? null,
        },
      },
      activeDispensers: status.activeDispensers ?? null,
      confidence: status.confidence ?? 0,
      freshness: status.freshness ?? 'UNKNOWN',
      computedAt: status.computedAt ?? null,
      lastOperatorUpdateAt: status.lastOperatorUpdateAt ?? null,
      lastUserUpdateAt: status.lastUserUpdateAt ?? null,

      /**
       * Whether ANY QLess observation currently backs this station.
       *
       * Explicit rather than left for the client to infer: a station discovered
       * from the place provider but never reported on has no live information,
       * and the UI must say so instead of rendering zeros or defaults.
       */
      hasLiveData:
        status.availability !== 'UNKNOWN' ||
        status.queueMin !== null ||
        status.waitMin !== null ||
        status.pressureValue !== null,
    },

    /** Where the record came from, and how to navigate to it. */
    source: station.source ?? 'MANUAL',
    placeId: station.placeId ?? null,
    googleMapsUri: station.placeData?.googleMapsUri ?? null,
  };
}

/** Status filters, applied inside the query so the radius is not narrowed later. */
function buildStatusFilter(filters = {}) {
  const conditions = {};

  if (filters.availability?.length) {
    conditions['status.availability'] = { $in: filters.availability };
  }
  if (filters.maxQueue !== undefined) {
    // Compare the LOWER bound: "8-15" can still satisfy "at most 10". Unknown
    // (null) is excluded rather than treated as 0 — absence of information is
    // not evidence of a short queue.
    conditions['status.queueMin'] = { $ne: null, $lte: filters.maxQueue };
  }
  if (filters.maxWait !== undefined) {
    conditions['status.waitMin'] = { $ne: null, $lte: filters.maxWait };
  }
  if (filters.minPressure !== undefined) {
    conditions['status.pressureValue'] = { $ne: null, $gte: filters.minPressure };
  }

  return conditions;
}

/** Ties break on distance; unknowns sort LAST — an unknown wait is not a short wait. */
function sortStations(stations, sort) {
  const byDistance = (a, b) =>
    (a.distanceM ?? Number.MAX_SAFE_INTEGER) - (b.distanceM ?? Number.MAX_SAFE_INTEGER);
  const nullsLast = (v) => v ?? Number.MAX_SAFE_INTEGER;

  const sorted = [...stations];
  switch (sort) {
    case 'wait':
      return sorted.sort(
        (a, b) => nullsLast(a.status.wait.min) - nullsLast(b.status.wait.min) || byDistance(a, b),
      );
    case 'queue':
      return sorted.sort(
        (a, b) => nullsLast(a.status.queue.min) - nullsLast(b.status.queue.min) || byDistance(a, b),
      );
    case 'recent':
      return sorted.sort((a, b) => {
        const at = a.status.computedAt ? new Date(a.status.computedAt).getTime() : 0;
        const bt = b.status.computedAt ? new Date(b.status.computedAt).getTime() : 0;
        return bt - at || byDistance(a, b);
      });
    default:
      return sorted.sort(byDistance);
  }
}

async function savedIdsFor(userId) {
  if (!userId) return new Set();
  const rows = await SavedStation.find({ user: userId }).select('station').lean();
  return new Set(rows.map((row) => String(row.station)));
}

const stationService = {
  /**
   * Nearby stations, NEAREST FIRST.
   *
   * Uses MongoDB `$geoNear`, which walks the 2dsphere index in distance order
   * and returns the distance itself — no post-hoc distance maths, and it scales
   * with local density rather than table size.
   */
  async findNearby({ latitude, longitude, radiusM, sort = 'distance', limit = 20, filters = {}, userId, discover = true }) {
    const radius = Math.min(radiusM ?? GEO.defaultSearchRadiusM, GEO.maxSearchRadiusM);

    // Learn about real stations we do not know yet, then read exclusively from
    // MongoDB below. Discovery never throws and never writes live status, so a
    // provider outage simply leaves the result set as whatever we already hold.
    if (discover) {
      await stationDiscoveryService.ensureCoverage({ latitude, longitude, radiusM: radius });
    }

    const results = await Station.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [longitude, latitude] },
          distanceField: 'distanceM',
          maxDistance: radius,
          // Inactive stations are never surfaced by discovery.
          query: { active: true, ...buildStatusFilter(filters) },
          spherical: true,
        },
      },
      // A generous cap so a pathological query cannot load the whole collection.
      { $limit: 500 },
    ]);

    const saved = await savedIdsFor(userId);
    const now = new Date();

    const stations = results.map((station) =>
      serializeStation(station, {
        distanceM: station.distanceM,
        saved: saved.has(String(station._id)),
        now,
      }),
    );

    // Sort first, THEN page: applying the caller's limit before the sort would
    // mean `sort=queue` only reordered the nearest N.
    return sortStations(stations, sort).slice(0, limit);
  },

  /** Full detail, with distance when the caller supplies their position. */
  async getById(stationId, { origin, userId } = {}) {
    if (!mongoose.isValidObjectId(stationId)) throw ApiError.notFound('Station not found');

    const station = await Station.findById(stationId).lean();
    if (!station) throw ApiError.notFound('Station not found');

    const distanceM = origin
      ? haversineDistanceM(origin, {
          latitude: station.location.coordinates[1],
          longitude: station.location.coordinates[0],
        })
      : null;

    const saved = await savedIdsFor(userId);
    const openSupplyEvents = await SupplyEvent.find({ station: stationId, endedAt: null })
      .sort({ startedAt: -1 })
      .lean();

    return {
      ...serializeStation(station, { distanceM, saved: saved.has(String(station._id)) }),
      openSupplyEvents,
    };
  },

  /** Simple paginated listing, used by the map/list screens. */
  async list({ page = 1, limit = 20, includeInactive = false, userId }) {
    const query = includeInactive ? {} : { active: true };

    const [stations, total] = await Promise.all([
      Station.find(query)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Station.countDocuments(query),
    ]);

    const saved = await savedIdsFor(userId);
    return {
      items: stations.map((s) => serializeStation(s, { saved: saved.has(String(s._id)) })),
      total,
    };
  },

  /**
   * Recommendation — SEPARATE from ordering.
   *
   * The returned station list stays nearest-first; this only annotates which
   * one would actually get the driver refuelled soonest (travel + wait + risk).
   */
  async recommend({ latitude, longitude, radiusM, limit = 20, userId }) {
    const stations = await this.findNearby({
      latitude,
      longitude,
      radiusM,
      sort: 'distance',
      limit,
      userId,
    });

    const approximateTravelMinutes = (distanceM) => {
      if (distanceM === null) return 0;
      const km = distanceM / 1000;
      return Math.round(
        (km / RECOMMENDATION.averageSpeedKmh) * 60 + RECOMMENDATION.fixedTravelOverheadMinutes,
      );
    };

    const scored = stations.map((station) => {
      const { status } = station;

      // The pessimistic end of the wait range is the honest basis for
      // comparison; it stops a wide, uncertain range beating a narrow one.
      const wait = status.wait.max ?? status.wait.min;

      let penalty = 0;
      if (status.availability === 'LOW_SUPPLY') penalty += RECOMMENDATION.lowSupplyPenaltyMinutes;
      if (status.availability === 'TEMPORARILY_INTERRUPTED') {
        penalty += RECOMMENDATION.interruptedPenaltyMinutes;
      }
      // No queue information is a risk, not a neutral fact.
      if (status.queue.min === null && status.queue.max === null) {
        penalty += RECOMMENDATION.unknownQueuePenaltyMinutes;
      }
      if (status.pressure.status === 'CRITICAL') penalty += RECOMMENDATION.lowSupplyPenaltyMinutes;

      const travel = approximateTravelMinutes(station.distanceM);

      /**
       * Eligibility is stricter than being listed: appearing in a list is
       * informational, but a recommendation actively sends someone across town.
       */
      let eligible = true;
      let reason = null;
      if (!station.active) {
        eligible = false;
        reason = 'station is not active';
      } else if (['UNAVAILABLE', 'TEMPORARILY_INTERRUPTED', 'UNKNOWN'].includes(status.availability)) {
        eligible = false;
        reason = `availability is ${status.availability}`;
      } else if (!RECOMMENDATION.acceptableFreshness.includes(status.freshness)) {
        eligible = false;
        reason = `data is ${status.freshness}`;
      } else if (status.confidence < RECOMMENDATION.minConfidenceToRecommend) {
        eligible = false;
        reason = `confidence ${status.confidence} is too low`;
      }

      return {
        stationId: station.id,
        name: station.name,
        distanceKm: station.distanceKm,
        travelMinutes: travel,
        waitMinutes: wait,
        effectiveMinutes: travel + (wait ?? 0) + penalty,
        penaltyMinutes: penalty,
        eligible,
        ineligibleReason: reason,
      };
    });

    const nearest = stations[0] ?? null;
    const eligible = scored.filter((s) => s.eligible);

    const recommendation = {
      recommendedStationId: null,
      nearestStationId: nearest?.id ?? null,
      differsFromNearest: false,
      savingMinutes: null,
      reason: null,
      alternatives: [],
      scores: scored,
    };

    if (!nearest || eligible.length === 0) {
      recommendation.reason = 'No station has data reliable enough to recommend';
      return { stations, recommendation };
    }

    const best = eligible.reduce((a, b) => (b.effectiveMinutes < a.effectiveMinutes ? b : a));
    const nearestScore = scored.find((s) => s.stationId === nearest.id);

    let chosen = best;
    let saving = nearestScore.effectiveMinutes - best.effectiveMinutes;

    /**
     * Prefer the nearest unless a farther one saves meaningful time — the
     * estimate is not precise enough to justify driving past a good station for
     * a one-minute modelled difference.
     */
    if (nearestScore.eligible && saving < RECOMMENDATION.minMeaningfulSavingMinutes) {
      chosen = nearestScore;
      saving = 0;
    }

    recommendation.recommendedStationId = chosen.stationId;
    recommendation.differsFromNearest = chosen.stationId !== nearest.id;
    recommendation.savingMinutes = recommendation.differsFromNearest ? saving : null;
    recommendation.reason = recommendation.differsFromNearest
      ? `${chosen.name} is further but should save roughly ${saving} min overall`
      : `${chosen.name} is both nearest and the fastest option`;
    recommendation.alternatives = eligible
      .filter((s) => s.stationId !== chosen.stationId)
      .sort((a, b) => a.effectiveMinutes - b.effectiveMinutes)
      .slice(0, RECOMMENDATION.maxAlternatives)
      .map((s) => ({
        stationId: s.stationId,
        name: s.name,
        distanceKm: s.distanceKm,
        savingMinutes: nearestScore.effectiveMinutes - s.effectiveMinutes,
        effectiveMinutes: s.effectiveMinutes,
      }));

    return { stations, recommendation };
  },

  travelAssumptions() {
    return {
      averageSpeedKmh: RECOMMENDATION.averageSpeedKmh,
      fixedOverheadMinutes: RECOMMENDATION.fixedTravelOverheadMinutes,
      approximate: true,
      note: 'Straight-line distance at an assumed city speed; not a routed ETA',
    };
  },

  serializeStation,
};

module.exports = stationService;
