'use strict';

const Report = require('../models/Report');
const Station = require('../models/Station');
const User = require('../models/User');
const env = require('../config/env');
const { REPORT_LIMITS, ROLES } = require('../config/constants');
const { ApiError } = require('../utils/ApiError');
const {
  haversineDistanceM,
  isPlausiblePressure,
  parseQueueLabel,
} = require('../utils/domain');
const stationStatusService = require('./stationStatus.service');
const notificationService = require('./notification.service');
const realtime = require('../sockets/realtime');

/**
 * Crowd reporting.
 *
 * Any signed-in USER may report queue and availability, and optionally
 * pressure — no operator assignment required. This is the platform's primary
 * data source; operators are a higher-trust supplement, not a prerequisite.
 */

/**
 * Decides the trust level of a report. The client sends coordinates; it does
 * NOT get to say whether they count as verified.
 */
function verifyLocation({ role, actingAsOperator, coords, station }) {
  const stationCoords = {
    latitude: station.location.coordinates[1],
    longitude: station.location.coordinates[0],
  };

  const distanceToStationM = coords
    ? Math.round(haversineDistanceM(coords, stationCoords))
    : null;

  // Operators and admins are trusted by role — an operator in the station
  // office is authoritative whether or not their phone reports GPS.
  if (actingAsOperator) {
    return { locationVerified: true, source: 'OPERATOR', distanceToStationM, coords };
  }
  if (role === ROLES.ADMIN) {
    return { locationVerified: true, source: 'ADMIN', distanceToStationM, coords };
  }

  // No coordinates: still accepted and stored, but not a first-hand sighting.
  if (!coords || distanceToStationM === null) {
    return {
      locationVerified: false,
      source: 'NORMAL_USER',
      distanceToStationM: null,
      coords: null,
    };
  }

  const within = distanceToStationM <= env.LOCATION_VERIFICATION_RADIUS_M;
  return {
    locationVerified: within,
    source: within ? 'VERIFIED_NEARBY_USER' : 'NORMAL_USER',
    distanceToStationM,
    coords,
  };
}

/**
 * Abuse controls, keyed per ACCOUNT and per STATION.
 *
 * Database-backed rather than IP-based on purpose: one user on mobile data
 * moves between IPs and a whole office shares one, so an IP key cannot express
 * the limit that matters. The IP limiter still runs in front as a coarse guard.
 */
async function assertNotThrottled(userId, stationId, payload, now = new Date()) {
  const [lastAnywhere, lastForStation] = await Promise.all([
    Report.findOne({ user: userId }).sort({ createdAt: -1 }).select('createdAt').lean(),
    Report.findOne({ user: userId, station: stationId })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean(),
  ]);

  const secondsSince = (date) => (now.getTime() - new Date(date).getTime()) / 1000;

  if (lastAnywhere) {
    const wait = Math.ceil(REPORT_LIMITS.globalCooldownSeconds - secondsSince(lastAnywhere.createdAt));
    if (wait > 0) {
      throw ApiError.reportCooldown(`Please wait ${wait}s before submitting another report`, wait);
    }
  }

  if (lastForStation) {
    const wait = Math.ceil(
      REPORT_LIMITS.perStationCooldownSeconds - secondsSince(lastForStation.createdAt),
    );
    if (wait > 0) {
      throw ApiError.reportCooldown(`You reported this station recently — please wait ${wait}s`, wait);
    }
  }

  const hourAgo = new Date(now.getTime() - 3600000);
  const [stationCount, totalCount] = await Promise.all([
    Report.countDocuments({ user: userId, station: stationId, createdAt: { $gte: hourAgo } }),
    Report.countDocuments({ user: userId, createdAt: { $gte: hourAgo } }),
  ]);

  // A submission writes up to 3 documents, so the caps are scaled accordingly.
  if (stationCount >= REPORT_LIMITS.maxReportsPerStationPerHour * 3) {
    throw ApiError.reportCooldown('You have reported this station too many times in the past hour');
  }
  if (totalCount >= REPORT_LIMITS.maxReportsPerHour * 3) {
    throw ApiError.reportCooldown('You have submitted too many reports in the past hour');
  }

  // Checked last: an identical repeat is the least severe case, and saying so
  // specifically is more useful to an honest client than a generic cooldown.
  const duplicateSince = new Date(now.getTime() - REPORT_LIMITS.duplicateWindowSeconds * 1000);
  const clauses = [];
  if (payload.queueLabel) {
    clauses.push({ kind: 'QUEUE', queueLabel: payload.queueLabel });
  }
  if (payload.availability) {
    clauses.push({ kind: 'AVAILABILITY', availability: payload.availability });
  }

  if (clauses.length > 0) {
    const matches = await Promise.all(
      clauses.map((clause) =>
        Report.exists({
          user: userId,
          station: stationId,
          createdAt: { $gte: duplicateSince },
          ...clause,
        }),
      ),
    );
    // Every component must match — a changed queue alongside an unchanged
    // availability is still new news.
    if (matches.every(Boolean)) {
      throw ApiError.duplicateReport(
        'You already submitted an identical report for this station recently',
      );
    }
  }
}

/** Nudges reporter reputation gradually — one report never swings it far. */
async function adjustReputation(userId, agreed) {
  const user = await User.findById(userId).select('reputation');
  if (!user) return;

  const target = agreed ? 85 : 45;
  const current = user.reputation?.score ?? 50;
  // Exponential move toward the target: one mistake cannot destroy a good
  // reporter, and one lucky report cannot mint a trusted one.
  const next = Math.round(current + 0.08 * (target - current));

  user.reputation.score = Math.max(0, Math.min(100, next));
  user.reputation.totalReports = (user.reputation.totalReports ?? 0) + 1;
  if (agreed) user.reputation.verifiedReports = (user.reputation.verifiedReports ?? 0) + 1;
  await user.save();
}

const reportService = {
  /**
   * Records an observation and refreshes the derived status.
   *
   * Partial reports are the norm — someone can see the queue from the road but
   * know nothing about pressure. Every field is optional; the only requirement
   * is that the submission says *something*.
   */
  async submit({ stationId, reporter, input, actingAsOperator = false }) {
    const station = await Station.findById(stationId);
    if (!station) throw ApiError.notFound('Station not found');
    if (!station.active && !actingAsOperator) {
      throw ApiError.badRequest('This station is not currently active');
    }

    const queue = input.queueRange ? parseQueueLabel(input.queueRange) : null;

    // An explicit "not sure" for everything carries no information at all.
    const reportsQueue = queue !== null && queue.min !== null;
    const reportsAvailability =
      input.availability !== undefined && input.availability !== 'UNKNOWN';
    const reportsPressure = input.pressureValue !== undefined && input.pressureValue !== null;
    const reportsDispensers =
      input.activeDispensers !== undefined && input.activeDispensers !== null;

    if (!reportsQueue && !reportsAvailability && !reportsPressure && !reportsDispensers) {
      throw ApiError.badRequest(
        'A report must include a queue length, an availability, or a pressure reading',
      );
    }

    const pressureUnit = input.pressureUnit ?? station.defaultPressureUnit;
    if (reportsPressure && !isPlausiblePressure(input.pressureValue, pressureUnit)) {
      throw ApiError.validation('Pressure reading is outside the plausible range', [
        { field: 'pressureValue', message: 'Value is not physically plausible' },
      ]);
    }

    if (reportsDispensers && input.activeDispensers > station.numberOfDispensers) {
      throw ApiError.validation('More active dispensers than the station has', [
        {
          field: 'activeDispensers',
          message: `This station has ${station.numberOfDispensers} dispensers`,
        },
      ]);
    }

    const coords =
      input.latitude !== undefined && input.longitude !== undefined
        ? { latitude: input.latitude, longitude: input.longitude }
        : null;

    const verification = verifyLocation({
      role: reporter.role,
      actingAsOperator,
      coords,
      station,
    });

    // Operators are exempt: a busy forecourt changes fast and they must keep up.
    if (!actingAsOperator && reporter.role !== ROLES.ADMIN) {
      await assertNotThrottled(reporter.id, stationId, {
        queueLabel: reportsQueue ? queue.label : null,
        availability: reportsAvailability ? input.availability : null,
      });
    }

    const geo = {
      locationVerified: verification.locationVerified,
      distanceToStationM: verification.distanceToStationM,
      ...(verification.coords
        ? {
            reportedLocation: {
              type: 'Point',
              coordinates: [verification.coords.longitude, verification.coords.latitude],
            },
          }
        : {}),
    };

    const base = {
      station: stationId,
      user: reporter.id,
      source: verification.source,
      note: input.note ?? null,
      ...geo,
    };

    const documents = [];
    if (reportsQueue) {
      documents.push({
        ...base,
        kind: 'QUEUE',
        queueMin: queue.min,
        queueMax: queue.max,
        queueLabel: queue.label,
      });
    }
    if (reportsAvailability || reportsDispensers) {
      documents.push({
        ...base,
        kind: 'AVAILABILITY',
        // Reporting only a dispenser count says nothing definite about
        // availability, so it is left UNKNOWN rather than assumed.
        availability: reportsAvailability ? input.availability : 'UNKNOWN',
        activeDispensers: reportsDispensers ? input.activeDispensers : null,
      });
    }
    if (reportsPressure) {
      documents.push({
        ...base,
        kind: 'PRESSURE',
        pressureValue: input.pressureValue,
        pressureUnit,
      });
    }

    const created = await Report.insertMany(documents);

    // Recomputed from the FULL history, never patched from this one report.
    const updated = await stationStatusService.recompute(stationId);

    // Fire-and-forget side effects: neither may fail the report itself.
    realtime.emitStationUpdated(updated);
    notificationService.evaluateStation(stationId).catch(() => {});

    if (!actingAsOperator && reporter.role === ROLES.USER) {
      adjustReputation(reporter.id, verification.locationVerified).catch(() => {});
    }

    const idsByKind = {};
    for (const doc of created) idsByKind[doc.kind.toLowerCase()] = String(doc._id);

    return {
      reportIds: {
        queue: idsByKind.queue,
        availability: idsByKind.availability,
        pressure: idsByKind.pressure,
      },
      locationVerified: verification.locationVerified,
      source: verification.source,
      distanceToStationM: verification.distanceToStationM,
      status: stationService_serializeStatus(updated),
    };
  },

  /** Raw report history — the append-only record behind the current status. */
  async history(stationId, { page = 1, limit = 20 }) {
    const station = await Station.exists({ _id: stationId });
    if (!station) throw ApiError.notFound('Station not found');

    const reports = await Report.find({ station: stationId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Grouped by kind to match the shape the frontend already consumes.
    return {
      queue: reports
        .filter((r) => r.kind === 'QUEUE')
        .map((r) => ({
          id: String(r._id),
          queueMin: r.queueMin,
          queueMax: r.queueMax,
          queueBucket: r.queueLabel,
          source: r.source,
          locationVerified: r.locationVerified,
          createdAt: r.createdAt,
        })),
      availability: reports
        .filter((r) => r.kind === 'AVAILABILITY')
        .map((r) => ({
          id: String(r._id),
          availability: r.availability,
          source: r.source,
          locationVerified: r.locationVerified,
          createdAt: r.createdAt,
        })),
      pressure: reports
        .filter((r) => r.kind === 'PRESSURE')
        .map((r) => ({
          id: String(r._id),
          pressureValue: r.pressureValue,
          pressureUnit: r.pressureUnit,
          source: r.source,
          locationVerified: r.locationVerified,
          createdAt: r.createdAt,
        })),
    };
  },
};

/** The raw status sub-document, as returned inside a submit response. */
function stationService_serializeStatus(station) {
  const s = station.status ?? {};
  return {
    availability: s.availability,
    queueMin: s.queueMin ?? null,
    queueMax: s.queueMax ?? null,
    queueBucket: s.queueLabel ?? 'UNKNOWN',
    waitMin: s.waitMin ?? null,
    waitMax: s.waitMax ?? null,
    pressureValue: s.pressureValue ?? null,
    pressureUnit: s.pressureUnit ?? 'BAR',
    pressureStatus: s.pressureStatus ?? 'UNKNOWN',
    activeDispensers: s.activeDispensers ?? null,
    confidence: s.confidence ?? 0,
    freshness: s.freshness ?? 'UNKNOWN',
    computedAt: s.computedAt ?? null,
    lastOperatorUpdateAt: s.lastOperatorUpdateAt ?? null,
    lastUserUpdateAt: s.lastUserUpdateAt ?? null,
  };
}

module.exports = reportService;
module.exports.verifyLocation = verifyLocation;
module.exports.serializeStatus = stationService_serializeStatus;
