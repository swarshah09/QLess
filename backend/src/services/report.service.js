'use strict';

const Report = require('../models/Report');
const Station = require('../models/Station');
const User = require('../models/User');
const QPointsEvent = require('../models/QPointsEvent');
const env = require('../config/env');
const {
  REPORT_LIMITS,
  GUEST_REPORT_LIMITS,
  REPORT_SUBMISSION_RADIUS_M,
  QPOINTS,
  ROLES,
} = require('../config/constants');
const { ApiError } = require('../utils/ApiError');
const logger = require('../config/logger');
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
 *
 * `isGuest` covers an unauthenticated submitter (`role` is undefined for a
 * guest, since there is no reporter object to read a role from). A guest's
 * `source` is always the GUEST floor, never VERIFIED_NEARBY_USER — being
 * physically close does not buy an anonymous submitter the same trust tier as
 * an accountable one — but `locationVerified` still varies correctly with
 * distance, independent of `source`, so confidence weighting still reflects
 * proximity.
 */
function verifyLocation({ role, isGuest = false, actingAsOperator, coords, station }) {
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

  const fallbackSource = isGuest ? 'GUEST' : 'NORMAL_USER';
  const verifiedSource = isGuest ? 'GUEST' : 'VERIFIED_NEARBY_USER';

  // No coordinates: still accepted and stored, but not a first-hand sighting.
  if (!coords || distanceToStationM === null) {
    return {
      locationVerified: false,
      source: fallbackSource,
      distanceToStationM: null,
      coords: null,
    };
  }

  const within = distanceToStationM <= env.LOCATION_VERIFICATION_RADIUS_M;
  return {
    locationVerified: within,
    source: within ? verifiedSource : fallbackSource,
    distanceToStationM,
    coords,
  };
}

/**
 * Abuse controls, keyed per ACCOUNT and per STATION — or, for a guest, per IP
 * and per STATION (a guest has no account to key on; IP is the only identity
 * available). `identity` is `{ userId }` for a logged-in reporter or
 * `{ guestIp }` for a guest; every query below builds its base filter from
 * whichever key is present and reads limits from the matching table, but the
 * cooldown/cap/duplicate-window MATH is identical either way — only the scope
 * changes, not the rules.
 *
 * Database-backed rather than IP-based for logged-in users on purpose: one
 * user on mobile data moves between IPs and a whole office shares one, so an
 * IP key cannot express the limit that matters for an account. The coarse
 * express-rate-limit IP guard still runs in front of both cases regardless.
 */
async function assertNotThrottled(identity, stationId, payload, now = new Date()) {
  const isGuest = 'guestIp' in identity;
  const limits = isGuest ? GUEST_REPORT_LIMITS : REPORT_LIMITS;
  const scopeFilter = isGuest ? { submitterIp: identity.guestIp } : { user: identity.userId };

  const hourAgo = new Date(now.getTime() - 3600000);
  const duplicateSince = new Date(now.getTime() - limits.duplicateWindowSeconds * 1000);
  const clauses = [];
  if (payload.queueLabel) {
    clauses.push({ kind: 'QUEUE', queueLabel: payload.queueLabel });
  }
  if (payload.availability) {
    clauses.push({ kind: 'AVAILABILITY', availability: payload.availability });
  }

  // Every read is issued at once — one round trip instead of three. The
  // verdicts below are still checked in order of severity, so the error a
  // client receives is unchanged.
  const [lastAnywhere, lastForStation, stationCount, totalCount, matches] = await Promise.all([
    Report.findOne(scopeFilter).sort({ createdAt: -1 }).select('createdAt').lean(),
    Report.findOne({ ...scopeFilter, station: stationId })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean(),
    Report.countDocuments({ ...scopeFilter, station: stationId, createdAt: { $gte: hourAgo } }),
    Report.countDocuments({ ...scopeFilter, createdAt: { $gte: hourAgo } }),
    Promise.all(
      clauses.map((clause) =>
        Report.exists({
          ...scopeFilter,
          station: stationId,
          createdAt: { $gte: duplicateSince },
          ...clause,
        }),
      ),
    ),
  ]);

  const secondsSince = (date) => (now.getTime() - new Date(date).getTime()) / 1000;

  if (lastAnywhere) {
    const wait = Math.ceil(limits.globalCooldownSeconds - secondsSince(lastAnywhere.createdAt));
    if (wait > 0) {
      throw ApiError.reportCooldown(`Please wait ${wait}s before submitting another report`, wait);
    }
  }

  if (lastForStation) {
    const wait = Math.ceil(
      limits.perStationCooldownSeconds - secondsSince(lastForStation.createdAt),
    );
    if (wait > 0) {
      throw ApiError.reportCooldown(`You reported this station recently — please wait ${wait}s`, wait);
    }
  }

  // A submission writes up to 3 documents, so the caps are scaled accordingly.
  if (stationCount >= limits.maxReportsPerStationPerHour * 3) {
    throw ApiError.reportCooldown('You have reported this station too many times in the past hour');
  }
  if (totalCount >= limits.maxReportsPerHour * 3) {
    throw ApiError.reportCooldown('You have submitted too many reports in the past hour');
  }

  // Checked last: an identical repeat is the least severe case, and saying so
  // specifically is more useful to an honest client than a generic cooldown.
  // Every component must match — a changed queue alongside an unchanged
  // availability is still new news.
  if (clauses.length > 0 && matches.every(Boolean)) {
    throw ApiError.duplicateReport(
      'You already submitted an identical report for this station recently',
    );
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

/** Per-kind equality used by the points-cooldown "unless changed" rule. */
function valuesEqualForKind(kind, previousReportDoc, newReportDoc) {
  if (kind === 'QUEUE') return previousReportDoc.queueLabel === newReportDoc.queueLabel;
  if (kind === 'AVAILABILITY') return previousReportDoc.availability === newReportDoc.availability;
  if (kind === 'PRESSURE') return previousReportDoc.pressureValue === newReportDoc.pressureValue;
  return true;
}

/**
 * Awards QPoints for a just-created, logged-in, accepted submission.
 *
 * No distance check here: submit() already rejects anything beyond
 * REPORT_SUBMISSION_RADIUS_M before a report can be created at all, so
 * reaching this function already guarantees the reporter was in range — a
 * second distance gate here would be unreachable dead logic.
 *
 * Applies, independently per kind, the per-kind cooldown: earning again for
 * the same user+station+kind requires either QPOINTS.perKindCooldownMinutes to
 * pass, or the new value to genuinely differ from the immediately-previous one
 * for that kind — an exact repeat inside the window earns 0 points, but the
 * report itself is ALWAYS stored regardless of what this function decides.
 *
 * A failure here is caught by the caller and logged, never allowed to fail an
 * already-successful report — matches the platform's existing fire-and-forget
 * pattern for reputation/notifications side effects.
 */
async function awardQPoints({ userId, stationId, createdReports, now = new Date() }) {
  // A submission holds at most one report per kind, and each kind is judged
  // only against its own ledger history, so the kinds are independent and are
  // processed concurrently.
  const awards = await Promise.all(
    createdReports.map((report) => awardForReport({ userId, stationId, report, now })),
  );

  const byKind = {};
  let totalAwarded = 0;
  for (const award of awards) {
    if (!award) continue;
    byKind[award.kind.toLowerCase()] = award.points;
    totalAwarded += award.points;
  }

  return { totalAwarded, byKind };
}

/** One kind's award decision; resolves null when this kind earns nothing. */
async function awardForReport({ userId, stationId, report, now }) {
  const kind = report.kind;
  const award = QPOINTS.awardByKind[kind];
  if (!award) return null;

  // The user's immediately-previous EARNED ledger entry for this exact
  // (user, station, kind) — used both for the cooldown window AND to check
  // whether the new value differs from it.
  const previousEvent = await QPointsEvent.findOne({
    user: userId,
    station: stationId,
    kind,
    type: 'EARNED',
  })
    .sort({ createdAt: -1 })
    .populate({ path: 'report', select: 'queueLabel availability pressureValue' })
    .lean();

  const cooldownActive =
    previousEvent &&
    (now.getTime() - new Date(previousEvent.createdAt).getTime()) / 60000 <
      QPOINTS.perKindCooldownMinutes;

  const valueChanged =
    !previousEvent?.report || !valuesEqualForKind(kind, previousEvent.report, report);

  // Exact repeat inside the window: 0 points for this kind. Everything else
  // (first-ever report of this kind, window elapsed, or a changed value
  // even inside the window) earns.
  if (cooldownActive && !valueChanged) return null;

  await QPointsEvent.create({
    user: userId,
    station: stationId,
    report: report._id,
    kind,
    type: 'EARNED',
    points: award,
  });

  return { kind, points: award };
}

const reportService = {
  /**
   * Records an observation and refreshes the derived status.
   *
   * Partial reports are the norm — someone can see the queue from the road but
   * know nothing about pressure. Every field is optional; the only requirement
   * is that the submission says *something*.
   */
  async submit({ stationId, reporter, input, actingAsOperator = false, guestIp = null }) {
    const queue = input.queueRange ? parseQueueLabel(input.queueRange) : null;

    // An explicit "not sure" for everything carries no information at all.
    const reportsQueue = queue !== null && queue.min !== null;
    const reportsAvailability =
      input.availability !== undefined && input.availability !== 'UNKNOWN';
    const reportsPressure = input.pressureValue !== undefined && input.pressureValue !== null;
    const reportsDispensers =
      input.activeDispensers !== undefined && input.activeDispensers !== null;

    // Operators are exempt: a busy forecourt changes fast and they must keep up.
    // A guest (reporter === null) is never an operator or admin, so the guard
    // always falls through to throttling for them, just IP-keyed instead of
    // account-keyed.
    const throttled = !actingAsOperator && (!reporter || reporter.role !== ROLES.ADMIN);

    // The throttle reads need nothing from the station document, so they start
    // now and overlap the station lookup. The verdict is still awaited at the
    // original point below, so every validation and range error keeps its
    // precedence; the no-op catch only stops an early validation error from
    // leaving this promise rejected and unobserved.
    const throttleCheck = throttled
      ? assertNotThrottled(reporter ? { userId: reporter.id } : { guestIp }, stationId, {
          queueLabel: reportsQueue ? queue.label : null,
          availability: reportsAvailability ? input.availability : null,
        })
      : null;
    throttleCheck?.catch(() => {});

    const station = await Station.findById(stationId);
    if (!station) throw ApiError.notFound('Station not found');
    if (!station.active && !actingAsOperator) {
      throw ApiError.badRequest('This station is not currently active');
    }

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
      role: reporter ? reporter.role : undefined,
      isGuest: reporter === null,
      actingAsOperator,
      coords,
      station,
    });

    // Hard eligibility gate: unlike locationVerified/QPoints eligibility above
    // (which only ever affected trust weighting or points), a report from
    // outside REPORT_SUBMISSION_RADIUS_M — or with no coordinates at all,
    // since proximity cannot be confirmed either way — is rejected outright.
    // Operators and admins are exempt: they are trusted by role, same as for
    // throttling below.
    if (throttled) {
      if (
        verification.distanceToStationM === null ||
        verification.distanceToStationM > REPORT_SUBMISSION_RADIUS_M
      ) {
        throw ApiError.outOfRange(
          verification.distanceToStationM === null
            ? `You must share your location to report this station (within ${REPORT_SUBMISSION_RADIUS_M}m)`
            : `You must be within ${REPORT_SUBMISSION_RADIUS_M}m of this station to report it — you are ${verification.distanceToStationM}m away`,
          verification.distanceToStationM,
        );
      }
    }

    if (throttleCheck) await throttleCheck;

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
      user: reporter ? reporter.id : null,
      submitterIp: reporter ? null : guestIp,
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

    // Both reputation and QPoints are earned only by a signed-in USER acting
    // as themselves — a guest has no account to hold either on, and an
    // operator/admin's own report is already trusted by role, not by these
    // accountability mechanisms.
    const earnsCredit = !actingAsOperator && reporter && reporter.role === ROLES.USER;

    // Recomputed from the FULL history, never patched from this one report —
    // reusing the station document loaded above rather than reading it again.
    // QPoints depend only on the reports just created, so they are awarded
    // concurrently with the recompute instead of after it.
    const [updated, qpoints] = await Promise.all([
      stationStatusService.recompute(stationId, { station }),
      earnsCredit
        ? awardQPoints({
            userId: reporter.id,
            stationId,
            createdReports: created,
          }).catch((err) => {
            // A points-award failure must never fail an already-successful report.
            logger.error('QPoints award failed', {
              error: err.message,
              userId: reporter.id,
              stationId,
            });
            return { totalAwarded: 0, byKind: {} };
          })
        : { totalAwarded: 0, byKind: {} },
    ]);

    // Fire-and-forget side effects: neither may fail the report itself.
    realtime.emitStationUpdated(updated);
    notificationService.evaluateStation(stationId, { station: updated }).catch(() => {});

    if (earnsCredit) {
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
      qpoints: { awarded: qpoints.totalAwarded, byKind: qpoints.byKind },
    };
  },

  /** Raw report history — the append-only record behind the current status. */
  async history(stationId, { page = 1, limit = 20 }) {
    // Issued together; a missing station still 404s before anything is returned.
    const [station, reports] = await Promise.all([
      Station.exists({ _id: stationId }),
      Report.find({ station: stationId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    if (!station) throw ApiError.notFound('Station not found');

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
