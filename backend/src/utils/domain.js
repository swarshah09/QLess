'use strict';

const {
  FRESHNESS_THRESHOLDS_MINUTES,
  GEO,
  PRESSURE_DEFAULTS,
  QUEUE_BUCKETS,
  WAIT_ESTIMATION,
} = require('../config/constants');

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/**
 * Converts a submitted label into numeric bounds.
 *
 * "UNKNOWN" yields null bounds — the whole point is that a user who does not
 * know the queue must not be recorded as having seen an empty forecourt.
 * The open-ended "25+" stores its lower bound as the max rather than inventing
 * a ceiling.
 */
function parseQueueLabel(label) {
  const normalized = String(label ?? '').trim().toUpperCase().replace(/[–—]/g, '-');
  if (normalized === 'UNKNOWN' || normalized === '') {
    return { label: 'UNKNOWN', min: null, max: null };
  }

  const match = QUEUE_BUCKETS.find(
    (bucket) => bucket.label.toUpperCase() === normalized && bucket.label !== 'UNKNOWN',
  );
  if (!match) return { label: 'UNKNOWN', min: null, max: null };

  return { label: match.label, min: match.min, max: match.max ?? match.min };
}

/** Numeric bounds → the bucket label a client displays. */
function queueLabelFor(min, max) {
  if (min === null && max === null) return 'UNKNOWN';
  const upper = max ?? min;
  const match = QUEUE_BUCKETS.find(
    (bucket) =>
      bucket.label !== 'UNKNOWN' &&
      upper >= bucket.min &&
      (bucket.max === null || upper <= bucket.max),
  );
  return match ? match.label : 'UNKNOWN';
}

const isUnknownQueue = (min, max) => min === null && max === null;

// ---------------------------------------------------------------------------
// Pressure
// ---------------------------------------------------------------------------

/** Conversion factors to bar, the internal canonical unit. */
const TO_BAR = { BAR: 1, PSI: 0.0689476, KPA: 0.01 };

const toBar = (value, unit) => value * (TO_BAR[unit] ?? 1);

/**
 * Classifies pressure RELATIVE to the station's own configured thresholds.
 * There is deliberately no universal "good pressure" — acceptable values differ
 * by equipment and region.
 */
function classifyPressure(valueInBar, station) {
  if (valueInBar === null || valueInBar === undefined || Number.isNaN(valueInBar)) {
    return 'UNKNOWN';
  }

  const low = station?.pressureThresholdLow ?? PRESSURE_DEFAULTS.thresholdLow;
  const normal = station?.pressureThresholdNormal ?? PRESSURE_DEFAULTS.thresholdNormal;

  if (valueInBar >= normal) return 'NORMAL';
  // Only a meaningful shortfall is CRITICAL, so a marginal dip is not over-reported.
  if (valueInBar <= low * 0.75) return 'CRITICAL';
  if (valueInBar <= low) return 'LOW';
  return 'NORMAL';
}

function isPlausiblePressure(value, unit) {
  const inBar = toBar(value, unit);
  return inBar >= PRESSURE_DEFAULTS.minAccepted && inBar <= PRESSURE_DEFAULTS.maxAccepted;
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/**
 * Age band for a timestamp. A missing or future timestamp is UNKNOWN, never
 * LIVE — data we cannot place in time must not look like the freshest we have.
 */
function freshnessFor(date, now = new Date(), thresholds = FRESHNESS_THRESHOLDS_MINUTES) {
  if (!date) return 'UNKNOWN';
  const ageMinutes = (now.getTime() - new Date(date).getTime()) / 60000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) return 'UNKNOWN';

  if (ageMinutes < thresholds.live) return 'LIVE';
  if (ageMinutes < thresholds.recent) return 'RECENT';
  if (ageMinutes < thresholds.aging) return 'AGING';
  if (ageMinutes < thresholds.expired) return 'STALE';
  return 'EXPIRED';
}

/** Multiplier applied to confidence for each band. */
const FRESHNESS_FACTOR = {
  LIVE: 1,
  RECENT: 0.9,
  AGING: 0.7,
  STALE: 0.4,
  EXPIRED: 0.1,
  UNKNOWN: 0,
};

// ---------------------------------------------------------------------------
// Wait estimation
// ---------------------------------------------------------------------------

/**
 * wait ≈ (vehicles ahead / dispensers) × fill time + fixed overhead
 *
 * Returns nulls — never a number — when the inputs cannot support one: an
 * unknown queue yields an unknown wait, and zero active dispensers means the
 * queue's duration is genuinely unknowable rather than instant.
 */
function estimateWait(queueMin, queueMax, activeDispensers, config = WAIT_ESTIMATION) {
  if (isUnknownQueue(queueMin, queueMax)) return { min: null, max: null };
  if (activeDispensers !== null && activeDispensers !== undefined && activeDispensers <= 0) {
    return { min: null, max: null };
  }

  const dispensers =
    activeDispensers && activeDispensers > 0 ? activeDispensers : config.fallbackDispensers;

  const aheadMin = queueMin ?? queueMax;
  const aheadMax = queueMax ?? queueMin;

  const rawMin =
    (aheadMin / dispensers) * config.minMinutesPerVehicle + config.minFixedOverheadMinutes;
  const rawMax =
    (aheadMax / dispensers) * config.maxMinutesPerVehicle + config.maxFixedOverheadMinutes;

  const step = config.roundToMinutes;
  // Rounded outward: the queue input is a bucket, so a tight output would be
  // false precision.
  const min = Math.max(0, Math.floor(rawMin / step) * step);
  let max = Math.max(min, Math.ceil(rawMax / step) * step);

  if (max - min < config.minimumSpreadMinutes) max = min + config.minimumSpreadMinutes;

  return { min, max };
}

// ---------------------------------------------------------------------------
// Geo
// ---------------------------------------------------------------------------

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres. */
function haversineDistanceM(a, b) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * GEO.earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Metres → km, rounded to 100 m; finer precision is not meaningful here. */
const metresToKm = (metres) => Math.round(metres / 100) / 10;

module.exports = {
  parseQueueLabel,
  queueLabelFor,
  isUnknownQueue,
  toBar,
  classifyPressure,
  isPlausiblePressure,
  freshnessFor,
  FRESHNESS_FACTOR,
  estimateWait,
  haversineDistanceM,
  metresToKm,
};
