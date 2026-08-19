'use strict';

const SavedStation = require('../models/SavedStation');
const Station = require('../models/Station');
const StationVisit = require('../models/StationVisit');
const env = require('../config/env');
const { ApiError } = require('../utils/ApiError');
const { haversineDistanceM, metresToKm } = require('../utils/domain');
const stationService = require('./station.service');

const MAX_SAVED_STATIONS = 50;
/** A visit older than this is abandoned rather than ongoing. */
const ACTIVE_VISIT_WINDOW_MINUTES = 240;

const savedStationService = {
  /** Saved stations with current status, nearest-first when coordinates are given. */
  async list(userId, origin) {
    const saved = await SavedStation.find({ user: userId })
      .populate('station')
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    const items = saved
      .filter((row) => row.station)
      .map((row) => {
        const distanceM = origin
          ? haversineDistanceM(origin, {
              latitude: row.station.location.coordinates[1],
              longitude: row.station.location.coordinates[0],
            })
          : null;

        return {
          id: String(row._id),
          label: row.label,
          sortOrder: row.sortOrder,
          createdAt: row.createdAt,
          station: stationService.serializeStation(row.station, { distanceM, saved: true }),
          distanceM: distanceM === null ? null : Math.round(distanceM),
          distanceKm: distanceM === null ? null : metresToKm(distanceM),
        };
      });

    if (origin) {
      items.sort(
        (a, b) =>
          (a.distanceM ?? Number.MAX_SAFE_INTEGER) - (b.distanceM ?? Number.MAX_SAFE_INTEGER),
      );
    }

    return items;
  },

  /** Idempotent — saving twice updates the label rather than erroring. */
  async save(userId, stationId, label) {
    if (!(await Station.exists({ _id: stationId }))) throw ApiError.notFound('Station not found');

    const alreadySaved = await SavedStation.exists({ user: userId, station: stationId });
    if (!alreadySaved) {
      const count = await SavedStation.countDocuments({ user: userId });
      if (count >= MAX_SAVED_STATIONS) {
        throw ApiError.badRequest(`You can save at most ${MAX_SAVED_STATIONS} stations`);
      }
    }

    const saved = await SavedStation.findOneAndUpdate(
      { user: userId, station: stationId },
      { user: userId, station: stationId, ...(label !== undefined ? { label } : {}) },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return { id: String(saved._id), stationId: String(stationId), label: saved.label };
  },

  async unsave(userId, stationId) {
    const result = await SavedStation.deleteOne({ user: userId, station: stationId });
    if (result.deletedCount === 0) {
      throw ApiError.notFound('This station is not in your saved list');
    }
  },
};

const visitService = {
  /**
   * "I'm Here". Rejected when the user is not actually near the station —
   * unlike a report, a visit is a claim about the user's own physical presence,
   * so an unverified one carries no meaning worth storing.
   */
  async checkIn(stationId, userId, coords) {
    const station = await Station.findById(stationId);
    if (!station) throw ApiError.notFound('Station not found');

    const distanceToStationM = Math.round(
      haversineDistanceM(coords, {
        latitude: station.location.coordinates[1],
        longitude: station.location.coordinates[0],
      }),
    );

    const radius = env.LOCATION_VERIFICATION_RADIUS_M;
    if (distanceToStationM > radius) {
      throw ApiError.validation('You do not appear to be at this station', [
        {
          field: 'location',
          message: `You are approximately ${distanceToStationM}m away; check in within ${radius}m`,
        },
      ]);
    }

    // Re-arriving during an open visit updates it rather than opening a second
    // one — a re-firing GPS should not accumulate duplicate visits.
    const cutoff = new Date(Date.now() - ACTIVE_VISIT_WINDOW_MINUTES * 60000);
    const existing = await StationVisit.findOne({
      user: userId,
      station: stationId,
      completedAt: null,
      createdAt: { $gte: cutoff },
    }).sort({ createdAt: -1 });

    const visit =
      existing ??
      (await StationVisit.create({
        user: userId,
        station: stationId,
        locationVerified: true,
        arrivedAt: new Date(),
        // Arriving says nothing about the outcome.
        outcome: 'UNKNOWN',
      }));

    if (existing && !existing.arrivedAt) {
      existing.arrivedAt = new Date();
      await existing.save();
    }

    return {
      visit: this.serialize(visit),
      locationVerified: true,
      distanceToStationM,
    };
  },

  async findOwned(visitId, userId) {
    const visit = await StationVisit.findById(visitId);
    // Someone else's visit reads as missing, so visit ids cannot be probed.
    if (!visit || String(visit.user) !== String(userId)) throw ApiError.notFound('Visit not found');
    return visit;
  },

  async joinQueue(visitId, userId) {
    const visit = await this.findOwned(visitId, userId);
    if (visit.completedAt) throw ApiError.conflict('This visit has already ended');

    if (!visit.joinedQueueAt) {
      visit.joinedQueueAt = new Date();
      await visit.save();
    }
    return this.serialize(visit);
  },

  /**
   * Ends a visit.
   *
   * `outcome` must come from the user. Leaving is NOT evidence of a successful
   * refuel — a driver who gave up and one who filled up both stop being at the
   * station, and conflating them would corrupt every wait measurement.
   */
  async complete(visitId, userId, outcome = 'UNKNOWN') {
    const visit = await this.findOwned(visitId, userId);
    if (visit.completedAt) throw ApiError.conflict('This visit has already ended');

    const completedAt = new Date();

    /**
     * An observed wait is recorded only for a confirmed refuel. For any other
     * outcome the elapsed time measures how long someone was willing to wait,
     * which is a different quantity and must not pollute wait estimates.
     */
    visit.observedWaitMinutes =
      outcome === 'REFUELLED' && visit.joinedQueueAt
        ? Math.max(0, Math.round((completedAt - visit.joinedQueueAt) / 60000))
        : null;

    visit.completedAt = completedAt;
    visit.outcome = outcome;
    await visit.save();

    return this.serialize(visit);
  },

  async list(userId, { page = 1, limit = 20 }) {
    const [items, total] = await Promise.all([
      StationVisit.find({ user: userId })
        .populate('station', 'name address')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      StationVisit.countDocuments({ user: userId }),
    ]);

    return {
      items: items.map((visit) => ({
        ...this.serialize(visit),
        station: visit.station
          ? { id: String(visit.station._id), name: visit.station.name }
          : null,
      })),
      total,
    };
  },

  serialize(visit) {
    return {
      id: String(visit._id),
      stationId: String(visit.station?._id ?? visit.station),
      arrivedAt: visit.arrivedAt ?? null,
      joinedQueueAt: visit.joinedQueueAt ?? null,
      completedAt: visit.completedAt ?? null,
      outcome: visit.outcome,
      observedWaitMinutes: visit.observedWaitMinutes ?? null,
      locationVerified: visit.locationVerified,
    };
  },
};

module.exports = { savedStationService, visitService };
