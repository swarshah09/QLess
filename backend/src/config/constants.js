'use strict';

const API_PREFIX = '/api/v1';

const ROLES = { USER: 'USER', STATION_OPERATOR: 'STATION_OPERATOR', ADMIN: 'ADMIN' };

const AVAILABILITY = [
  'AVAILABLE',
  'LOW_SUPPLY',
  'TEMPORARILY_INTERRUPTED',
  'UNAVAILABLE',
  'UNKNOWN',
];

/** Who produced a report — materially changes how much it is trusted. */
const REPORT_SOURCES = [
  'OPERATOR',
  'VERIFIED_NEARBY_USER',
  'NORMAL_USER',
  'ADMIN',
  'SYSTEM_ESTIMATE',
];

const SOURCE_WEIGHTS = {
  OPERATOR: 1,
  ADMIN: 1,
  VERIFIED_NEARBY_USER: 0.7,
  NORMAL_USER: 0.35,
  SYSTEM_ESTIMATE: 0.2,
};

const PRESSURE_UNITS = ['BAR', 'PSI', 'KPA'];
const PRESSURE_STATUSES = ['NORMAL', 'LOW', 'CRITICAL', 'UNKNOWN'];

/**
 * Canonical queue buckets. `max: null` means open-ended. UNKNOWN carries null
 * bounds and must NEVER be coerced to 0 — no data is not an empty forecourt.
 */
const QUEUE_BUCKETS = [
  { label: '0-3', min: 0, max: 3 },
  { label: '4-7', min: 4, max: 7 },
  { label: '8-15', min: 8, max: 15 },
  { label: '16-25', min: 16, max: 25 },
  { label: '25+', min: 26, max: null },
  { label: 'UNKNOWN', min: null, max: null },
];

const QUEUE_LABELS = QUEUE_BUCKETS.map((b) => b.label);

/** Upper bound of each age band, in minutes. */
const FRESHNESS_THRESHOLDS_MINUTES = { live: 5, recent: 15, aging: 30, expired: 180 };
const FRESHNESS_LEVELS = ['LIVE', 'RECENT', 'AGING', 'STALE', 'EXPIRED', 'UNKNOWN'];

/** Reports older than this contribute nothing to the current status. */
const STATUS_INPUT_WINDOW_MINUTES = 120;

/** Deliberately simple queueing model: wait ≈ (queue / dispensers) × fill time. */
const WAIT_ESTIMATION = {
  minMinutesPerVehicle: 2,
  maxMinutesPerVehicle: 4,
  minFixedOverheadMinutes: 1,
  maxFixedOverheadMinutes: 3,
  fallbackDispensers: 1,
  /** Rounded outward — a bucketed queue cannot support a tighter answer. */
  roundToMinutes: 5,
  minimumSpreadMinutes: 5,
};

/** Platform pressure fallbacks in bar. Station config always wins. */
const PRESSURE_DEFAULTS = {
  thresholdLow: 150,
  thresholdNormal: 200,
  minAccepted: 0,
  maxAccepted: 350,
};

/** Abuse controls — bound abuse without discouraging honest reporting. */
const REPORT_LIMITS = {
  perStationCooldownSeconds: 60,
  globalCooldownSeconds: 10,
  maxReportsPerHour: 30,
  maxReportsPerStationPerHour: 6,
  duplicateWindowSeconds: 600,
};

const NOTIFICATIONS = {
  defaultCooldownMinutes: 30,
  minCooldownMinutes: 5,
  maxCooldownMinutes: 1440,
  maxRulesPerUser: 50,
  maxSubscriptionsPerUser: 10,
  /** Too stale to be worth waking someone for. */
  minFreshnessToNotify: ['LIVE', 'RECENT'],
  minConfidenceToNotify: 40,
  deepLinkPattern: '/stations/{stationId}',
};

const RECOMMENDATION = {
  averageSpeedKmh: 22,
  fixedTravelOverheadMinutes: 2,
  /** A farther station must save at least this much to be preferred. */
  minMeaningfulSavingMinutes: 8,
  minConfidenceToRecommend: 50,
  acceptableFreshness: ['LIVE', 'RECENT', 'AGING'],
  maxAlternatives: 3,
  lowSupplyPenaltyMinutes: 6,
  interruptedPenaltyMinutes: 20,
  unknownQueuePenaltyMinutes: 5,
};

const GEO = {
  earthRadiusM: 6371000,
  defaultSearchRadiusM: 5000,
  // 100 km. Wide enough for regions where CNG coverage is sparse and the
  // nearest station is well outside a metro-sized radius.
  maxSearchRadiusM: 100000,
};

/**
 * External place-provider discovery.
 *
 * Discovery supplies station IDENTITY and LOCATION only. Queue, availability,
 * pressure and wait time are QLess data, derived solely from Report documents,
 * and are never inferred from provider metadata.
 */
const PLACES = {
  /** Skip the provider entirely when we already know enough stations nearby. */
  minCachedStationsToSkipLookup: 3,
  /** Re-fetch provider details for a station at most this often. */
  refreshAfterMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  /** Provider-side search ceiling (Nearby Search allows at most 50 km). */
  maxSearchRadiusM: 50000,
  maxResults: 20,
  /** Two hits closer than this are treated as the same physical station. */
  dedupeDistanceM: 60,
  /** Provider request budget per discovery call. */
  timeoutMs: 8000,
};

const PAGINATION = { defaultPage: 1, defaultLimit: 20, maxLimit: 100 };

const SUPPLY_EVENT_TYPES = [
  'SUPPLY_ARRIVED',
  'LOW_SUPPLY',
  'CNG_FINISHED',
  'TEMPORARY_INTERRUPTION',
  'SUPPLY_RESTORED',
  'MAINTENANCE_START',
  'MAINTENANCE_END',
  'STATION_CLOSED',
  'STATION_REOPENED',
];

const VISIT_OUTCOMES = [
  'UNKNOWN',
  'REFUELLED',
  'ABANDONED_QUEUE',
  'STATION_UNAVAILABLE',
];

module.exports = {
  API_PREFIX,
  ROLES,
  AVAILABILITY,
  REPORT_SOURCES,
  SOURCE_WEIGHTS,
  PRESSURE_UNITS,
  PRESSURE_STATUSES,
  QUEUE_BUCKETS,
  QUEUE_LABELS,
  FRESHNESS_THRESHOLDS_MINUTES,
  FRESHNESS_LEVELS,
  STATUS_INPUT_WINDOW_MINUTES,
  WAIT_ESTIMATION,
  PRESSURE_DEFAULTS,
  REPORT_LIMITS,
  NOTIFICATIONS,
  RECOMMENDATION,
  GEO,
  PLACES,
  PAGINATION,
  SUPPLY_EVENT_TYPES,
  VISIT_OUTCOMES,
};
