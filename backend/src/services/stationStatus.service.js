'use strict';

const Report = require('../models/Report');
const Station = require('../models/Station');
const logger = require('../config/logger');
const {
  SOURCE_WEIGHTS,
  STATUS_INPUT_WINDOW_MINUTES,
} = require('../config/constants');
const { ApiError } = require('../utils/ApiError');
const {
  FRESHNESS_FACTOR,
  classifyPressure,
  estimateWait,
  freshnessFor,
  queueLabelFor,
  toBar,
} = require('../utils/domain');

/**
 * Derives a station's current state from its recent raw reports.
 *
 * The rule this exists to enforce: NEVER just take the latest report. Every
 * answer is a weighted consensus over the input window, where each report is
 * scaled by its source, its age and its reporter's reliability.
 *
 * Raw reports are only ever READ here. The single output is the embedded
 * `station.status`, which is disposable derived data.
 */

const AUTHORITATIVE = new Set(['OPERATOR', 'ADMIN']);

/** Linear decay to zero across the window — old reports fade, never vanish abruptly. */
function recencyWeight(createdAt, now, windowMinutes) {
  const ageMinutes = (now.getTime() - new Date(createdAt).getTime()) / 60000;
  if (ageMinutes <= 0) return 1;
  if (ageMinutes >= windowMinutes) return 0;
  return 1 - ageMinutes / windowMinutes;
}

/**
 * Combined weight: source trust × recency × reporter reliability.
 *
 * Reputation is applied separately from the source weight so the two stay
 * independently tunable — and a poor-reputation operator is still an operator.
 */
function weightOf(report, now, windowMinutes, reputationByUser) {
  const source = SOURCE_WEIGHTS[report.source] ?? 0.2;
  const recency = recencyWeight(report.createdAt, now, windowMinutes);

  const userId = report.user ? String(report.user) : null;
  const reputation = userId ? (reputationByUser.get(userId) ?? 1) : 1;

  return source * recency * reputation;
}

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/**
 * Flags outliers by modified z-score.
 *
 * MAD is used rather than mean/stddev because it resists the very values it is
 * meant to find. It collapses to zero when most samples are identical — the
 * normal shape for bucketed queue reports — so the mean absolute deviation is
 * the fallback; without it a lone wild report among identical ones is invisible.
 *
 * Outliers are DOWNWEIGHTED, never dropped: a lone dissenter may be the first
 * person to notice a change.
 */
function detectOutliers(values, exempt) {
  const none = values.map(() => false);
  if (values.length < 4) return none;

  const centre = median(values);
  const deviations = values.map((v) => Math.abs(v - centre));
  const mad = median(deviations);

  const useMad = mad > 0;
  const spread = useMad
    ? mad
    : deviations.reduce((sum, d) => sum + d, 0) / deviations.length;
  const scale = useMad ? 0.6745 : 0.7979;

  if (spread === 0) return none;

  return values.map((value, index) => {
    if (exempt[index]) return false;
    return (scale * Math.abs(value - centre)) / spread > 3.5;
  });
}

/**
 * Resolves availability.
 *
 * An operator's most recent statement WINS OUTRIGHT rather than counting as one
 * vote — they are describing their own forecourt, and letting slightly older
 * crowd reports out-vote them would keep sending drivers to an empty station.
 */
function resolveAvailability(reports, now, windowMinutes, reputationByUser) {
  const stated = reports.filter(
    (r) =>
      r.availability &&
      r.availability !== 'UNKNOWN' &&
      weightOf(r, now, windowMinutes, reputationByUser) > 0,
  );

  if (stated.length === 0) {
    return { availability: 'UNKNOWN', agreement: 0, totalWeight: 0 };
  }

  const authoritative = stated
    .filter((r) => AUTHORITATIVE.has(r.source))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  let winner;
  if (authoritative.length > 0) {
    winner = authoritative[0].availability;
  } else {
    const tally = new Map();
    for (const report of stated) {
      const w = weightOf(report, now, windowMinutes, reputationByUser);
      tally.set(report.availability, (tally.get(report.availability) ?? 0) + w);
    }
    winner = 'UNKNOWN';
    let best = 0;
    for (const [availability, weight] of tally) {
      if (weight > best) {
        winner = availability;
        best = weight;
      }
    }
  }

  let agreeing = 0;
  let total = 0;
  for (const report of stated) {
    const w = weightOf(report, now, windowMinutes, reputationByUser);
    total += w;
    if (report.availability === winner) agreeing += w;
  }

  return {
    availability: winner,
    agreement: total > 0 ? agreeing / total : 0,
    totalWeight: total,
  };
}

/**
 * Weighted average of reported queue bounds.
 *
 * Reports where the user chose "not sure" carry no bounds and are skipped
 * entirely — never counted as zero — so a station nobody can see stays UNKNOWN
 * rather than appearing empty.
 */
function resolveQueue(reports, now, windowMinutes, reputationByUser) {
  const known = reports.filter(
    (r) =>
      (r.queueMin !== null || r.queueMax !== null) &&
      weightOf(r, now, windowMinutes, reputationByUser) > 0,
  );

  if (known.length === 0) {
    return { min: null, max: null, totalWeight: 0, outliers: 0, samples: 0 };
  }

  // Midpoint is the outlier axis: a "0-3" against a consensus of "16-25"
  // should be judged on where it sits, not on how wide it is.
  const midpoints = known.map((r) => {
    const min = r.queueMin ?? r.queueMax;
    const max = r.queueMax ?? r.queueMin;
    return (min + max) / 2;
  });
  const flags = detectOutliers(midpoints, known.map((r) => AUTHORITATIVE.has(r.source)));

  let weightedMin = 0;
  let weightedMax = 0;
  let totalWeight = 0;

  known.forEach((report, index) => {
    const weight =
      weightOf(report, now, windowMinutes, reputationByUser) * (flags[index] ? 0.25 : 1);
    if (weight <= 0) return;

    weightedMin += (report.queueMin ?? report.queueMax) * weight;
    weightedMax += (report.queueMax ?? report.queueMin) * weight;
    totalWeight += weight;
  });

  if (totalWeight === 0) {
    return { min: null, max: null, totalWeight: 0, outliers: 0, samples: 0 };
  }

  const min = Math.round(weightedMin / totalWeight);
  const max = Math.round(weightedMax / totalWeight);

  return {
    // Ordering defended explicitly: rounding two independent weighted means can
    // otherwise invert them when reports disagree about width.
    min: Math.min(min, max),
    max: Math.max(min, max),
    totalWeight,
    outliers: flags.filter(Boolean).length,
    samples: known.length,
  };
}

/** Weighted average pressure, normalised to bar for comparability. */
function resolvePressure(reports, now, windowMinutes, reputationByUser) {
  const usable = reports.filter(
    (r) =>
      r.pressureValue !== null &&
      r.pressureValue !== undefined &&
      weightOf(r, now, windowMinutes, reputationByUser) > 0,
  );

  if (usable.length === 0) return { valueBar: null, totalWeight: 0, outliers: 0 };

  const values = usable.map((r) => toBar(r.pressureValue, r.pressureUnit));
  const flags = detectOutliers(values, usable.map((r) => AUTHORITATIVE.has(r.source)));

  let weightedSum = 0;
  let totalWeight = 0;

  usable.forEach((report, index) => {
    const weight =
      weightOf(report, now, windowMinutes, reputationByUser) * (flags[index] ? 0.25 : 1);
    if (weight <= 0) return;
    weightedSum += values[index] * weight;
    totalWeight += weight;
  });

  if (totalWeight === 0) return { valueBar: null, totalWeight: 0, outliers: 0 };

  return {
    // One decimal: the inputs are eyeballed gauge readings, so more is false precision.
    valueBar: Math.round((weightedSum / totalWeight) * 10) / 10,
    totalWeight,
    outliers: flags.filter(Boolean).length,
  };
}

/**
 * Confidence, 0-100. Deliberately explainable rather than learned — a driver
 * deciding whether to cross town deserves a number they can reason about.
 *
 *   source (40) · agreement (25) · freshness (20) · corroboration (15)
 *
 * The freshness factor then multiplies the WHOLE score, so ageing drags
 * everything down; otherwise a stale operator report would still read as
 * highly confident.
 */
function computeConfidence({
  bestSourceWeight,
  agreement,
  freshness,
  distinctReporters,
  outlierCount,
  hasInput,
}) {
  if (!hasInput || freshness === 'UNKNOWN') return 0;

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const factor = FRESHNESS_FACTOR[freshness] ?? 0;

  let total =
    clamp01(bestSourceWeight) * 40 +
    clamp01(agreement) * 25 +
    factor * 20 +
    clamp01(distinctReporters / 3) * 15;

  // Outliers mean the inputs conflict in a way consensus had to discard.
  if (outlierCount > 0 && distinctReporters > 0) {
    total *= 1 - 0.3 * clamp01(outlierCount / distinctReporters);
  }

  total *= factor;
  return Math.max(0, Math.min(100, Math.round(total)));
}

const stationStatusService = {
  /**
   * Recomputes and persists a station's status.
   *
   * Safe to call as often as needed — it reads history and writes only derived
   * data. Called after every report and operator update so the projection never
   * lags its inputs.
   */
  async recompute(stationId, options = {}) {
    const now = options.now ?? new Date();
    const windowMinutes = options.windowMinutes ?? STATUS_INPUT_WINDOW_MINUTES;

    const station = await Station.findById(stationId);
    if (!station) throw ApiError.notFound('Station not found');

    const since = new Date(now.getTime() - windowMinutes * 60000);

    // One query for all three report kinds — the reason they share a collection.
    const reports = await Report.find({ station: stationId, createdAt: { $gte: since } })
      .populate('user', 'reputation')
      .lean();

    /**
     * Reputation modulates weight within a bounded band, so it never silences a
     * reporter nor lets one trusted user override everyone. A reporter with too
     * little history stays neutral rather than being penalised for being new.
     */
    const reputationByUser = new Map();
    for (const report of reports) {
      if (!report.user?._id) continue;
      const rep = report.user.reputation;
      const multiplier =
        !rep || rep.totalReports < 3 ? 1 : 0.6 + Math.max(0, Math.min(1, rep.score / 100)) * 0.65;
      reputationByUser.set(String(report.user._id), multiplier);
    }

    const queueReports = reports.filter((r) => r.kind === 'QUEUE');
    const availabilityReports = reports.filter((r) => r.kind === 'AVAILABILITY');
    const pressureReports = reports.filter((r) => r.kind === 'PRESSURE');

    const availability = resolveAvailability(
      availabilityReports,
      now,
      windowMinutes,
      reputationByUser,
    );
    const queue = resolveQueue(queueReports, now, windowMinutes, reputationByUser);
    const pressure = resolvePressure(pressureReports, now, windowMinutes, reputationByUser);

    // Most recent operator-observed dispenser count within the window.
    const withDispensers = availabilityReports
      .filter((r) => r.activeDispensers !== null && r.activeDispensers !== undefined)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const activeDispensers = withDispensers[0]?.activeDispensers ?? null;

    const wait = estimateWait(
      queue.min,
      queue.max,
      activeDispensers ?? station.numberOfDispensers,
    );

    const timestamps = reports.map((r) => new Date(r.createdAt).getTime());
    const newestInputAt = timestamps.length ? new Date(Math.max(...timestamps)) : null;
    const freshness = freshnessFor(newestInputAt, now);

    const latestBy = (predicate) => {
      const matching = reports
        .filter((r) => predicate(r.source))
        .map((r) => new Date(r.createdAt).getTime());
      return matching.length ? new Date(Math.max(...matching)) : null;
    };

    const hasInput =
      availability.totalWeight > 0 || queue.totalWeight > 0 || pressure.totalWeight > 0;

    const bestSourceWeight = reports.reduce((best, report) => {
      if (recencyWeight(report.createdAt, now, windowMinutes) <= 0) return best;
      return Math.max(best, SOURCE_WEIGHTS[report.source] ?? 0.2);
    }, 0);

    const distinctReporters = new Set(
      reports.filter((r) => r.user?._id).map((r) => String(r.user._id)),
    ).size;

    station.status = {
      availability: availability.availability,
      queueMin: queue.min,
      queueMax: queue.max,
      queueLabel: queueLabelFor(queue.min, queue.max),
      waitMin: wait.min,
      waitMax: wait.max,
      pressureValue: pressure.valueBar,
      pressureUnit: 'BAR',
      pressureStatus: classifyPressure(pressure.valueBar, station),
      activeDispensers,
      confidence: computeConfidence({
        bestSourceWeight,
        // With no availability reports there is nothing to agree about; treat
        // it as neutral rather than crediting or penalising consensus.
        agreement: availability.totalWeight > 0 ? availability.agreement : 0.5,
        freshness,
        distinctReporters,
        outlierCount: queue.outliers + pressure.outliers,
        hasInput,
      }),
      freshness,
      computedAt: now,
      lastOperatorUpdateAt: latestBy((s) => s === 'OPERATOR' || s === 'ADMIN'),
      lastUserUpdateAt: latestBy(
        (s) => s === 'VERIFIED_NEARBY_USER' || s === 'NORMAL_USER',
      ),
    };

    await station.save();

    logger.debug('Station status recomputed', {
      stationId: String(stationId),
      availability: station.status.availability,
      confidence: station.status.confidence,
    });

    return station;
  },

  /**
   * Re-derives freshness and confidence for the current moment.
   *
   * This is the lightweight decay mechanism: no background job is required for
   * a status to stop reading as live. A status written LIVE forty minutes ago is
   * SERVED as STALE because read paths call this.
   */
  decay(status, now = new Date()) {
    if (!status) return status;

    const newest = [status.lastOperatorUpdateAt, status.lastUserUpdateAt]
      .filter(Boolean)
      .map((d) => new Date(d).getTime());

    const current = newest.length
      ? freshnessFor(new Date(Math.max(...newest)), now)
      : 'UNKNOWN';

    if (current === status.freshness) return status;

    const previousFactor = FRESHNESS_FACTOR[status.freshness] || 1;
    const nextFactor = FRESHNESS_FACTOR[current] ?? 0;

    return {
      ...status,
      freshness: current,
      // Rescaled so a status that aged out of LIVE stops claiming the
      // confidence it had while live.
      confidence: Math.max(
        0,
        Math.min(100, Math.round((status.confidence / previousFactor) * nextFactor)),
      ),
    };
  },
};

module.exports = stationStatusService;
