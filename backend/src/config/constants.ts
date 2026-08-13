import { PressureUnit, QueueBucket } from '@prisma/client';

export const API_PREFIX = '/api/v1';

/**
 * Platform-level pressure defaults, expressed in bar.
 *
 * These are FALLBACKS only. A station's own `pressureThresholdLow` /
 * `pressureThresholdNormal` always win — what counts as good pressure varies by
 * equipment and region, so it must never be hard-coded as a universal truth.
 */
export const PRESSURE_DEFAULTS = {
  unit: PressureUnit.BAR,
  /// At or below this, pressure is considered LOW for a station with no config.
  thresholdLow: 150,
  /// At or above this, pressure is considered NORMAL.
  thresholdNormal: 200,
  /// Sanity bounds for accepting a reported value (in bar).
  minAccepted: 0,
  maxAccepted: 350,
} as const;

/**
 * Canonical queue buckets. `min`/`max` are inclusive; `max: null` means
 * open-ended. UNKNOWN carries null bounds and must never be coerced to 0.
 */
export const QUEUE_BUCKETS: ReadonlyArray<{
  bucket: QueueBucket;
  min: number | null;
  max: number | null;
  label: string;
}> = [
  { bucket: QueueBucket.RANGE_0_3, min: 0, max: 3, label: '0-3' },
  { bucket: QueueBucket.RANGE_4_7, min: 4, max: 7, label: '4-7' },
  { bucket: QueueBucket.RANGE_8_15, min: 8, max: 15, label: '8-15' },
  { bucket: QueueBucket.RANGE_16_25, min: 16, max: 25, label: '16-25' },
  { bucket: QueueBucket.RANGE_25_PLUS, min: 26, max: null, label: '25+' },
  { bucket: QueueBucket.UNKNOWN, min: null, max: null, label: 'Unknown' },
];

/** Largest queue size a report may claim, guarding against typos/abuse. */
export const MAX_QUEUE_SIZE = 500;

/**
 * Freshness cutoffs, in minutes. Upper bound of each band:
 *   0-5 LIVE · 5-15 RECENT · 15-30 AGING · 30+ STALE · past `expired` EXPIRED.
 *
 * Tunable in one place — every consumer derives its band from these rather than
 * hard-coding an age comparison.
 */
export const FRESHNESS_THRESHOLDS_MINUTES = {
  live: 5,
  recent: 15,
  aging: 30,
  /**
   * Past this, data is too old to present as current at all. It sits well
   * beyond STALE so a station with genuinely old reports still shows something
   * clearly labelled rather than silently vanishing.
   */
  expired: 180,
} as const;

/**
 * Geofence radius for location verification, in metres.
 *
 * Configurable via `LOCATION_VERIFICATION_RADIUS_M`; this is only the default.
 * A report from inside this radius is trusted as a first-hand observation
 * (`VERIFIED_NEARBY_USER`); outside it, the report is still stored but weighs
 * less (`NORMAL_USER`). The verification itself is always computed server-side
 * from the submitted coordinates — a client-supplied flag is never consulted.
 */
export const DEFAULT_LOCATION_VERIFICATION_RADIUS_M = 200;

/**
 * Report throttling. Frequent honest updates are useful, so these bound abuse
 * rather than discourage participation.
 */
export const REPORT_LIMITS = {
  /** Minimum gap between one user's reports for the SAME station. */
  perStationCooldownSeconds: 60,
  /** Minimum gap between one user's reports for ANY station. */
  globalCooldownSeconds: 10,
  /** Cap on one user's reports across all stations per hour. */
  maxReportsPerHour: 30,
  /** Cap on one user's reports for a single station per hour. */
  maxReportsPerStationPerHour: 6,
  /**
   * An identical payload from the same user for the same station inside this
   * window is treated as a duplicate submission (a double-tap or a retry)
   * rather than new evidence.
   */
  duplicateWindowSeconds: 600,
} as const;

/**
 * Wait-time estimation.
 *
 * A deliberately simple, deterministic queueing model:
 *   wait ≈ (vehicles ahead / dispensers) × fill time + fixed overhead
 *
 * Transparent and explainable, which matters more than precision here —
 * anything learned from history belongs to a later analytics phase.
 */
export const WAIT_ESTIMATION = {
  /** Optimistic and pessimistic minutes to fill one vehicle. */
  minMinutesPerVehicle: 2,
  maxMinutesPerVehicle: 4,
  /**
   * Per-visit overhead independent of queue length — pulling in, paying,
   * pulling out. Without it a queue of zero implies a wait of zero, which is
   * never true in practice.
   */
  minFixedOverheadMinutes: 1,
  maxFixedOverheadMinutes: 3,
  /** Assumed dispensers when a station has not reported a usable count. */
  fallbackDispensers: 1,
  /**
   * Estimates are rounded outward to this many minutes. Reporting "12-19 min"
   * from a bucketed queue would be false precision; "10-20" is honest about
   * what the inputs actually support.
   */
  roundToMinutes: 5,
  /** Never claim a tighter range than this. */
  minimumSpreadMinutes: 5,
} as const;

/**
 * Outlier handling.
 *
 * Reports that disagree sharply with the weighted consensus are downweighted
 * rather than deleted — a lone dissenter may be the only person who has noticed
 * a change, so their report still counts, just less.
 */
export const OUTLIER_DETECTION = {
  /**
   * Absolute deviations from the median beyond this multiple of the MAD are
   * treated as outliers. 3.5 is the conventional modified z-score cutoff.
   */
  madThreshold: 3.5,
  /** Weight multiplier applied to a detected outlier, never 0. */
  downweightFactor: 0.25,
  /**
   * Below this many samples there is no meaningful consensus to deviate from,
   * so nothing is flagged.
   */
  minSamplesToDetect: 4,
  /** An authoritative source is never treated as an outlier. */
  exemptSources: ['OPERATOR', 'ADMIN'] as const,
} as const;

/**
 * Reporter reputation.
 *
 * Scores move gradually: one bad report should not destroy a good reporter, and
 * one lucky report should not mint a trusted one.
 */
export const REPUTATION = {
  startingScore: 50,
  minScore: 0,
  maxScore: 100,
  /** Fraction of the gap to the target moved per event (exponential decay). */
  learningRate: 0.08,
  /** Targets the score moves toward for each observed behaviour. */
  targets: {
    agreedAndVerified: 100,
    agreed: 85,
    neutral: 50,
    disagreed: 30,
    outlier: 10,
  },
  /**
   * How much reputation is allowed to scale a report's weight. 1.0 means score
   * has no effect; the band keeps a poor reporter audible and a great one from
   * dominating.
   */
  weightInfluence: { min: 0.6, max: 1.25 },
  /**
   * Below this many reports a user's score is not yet meaningful, so their
   * weight multiplier stays neutral.
   */
  minReportsForInfluence: 3,
} as const;

/**
 * Weights used when combining reports into the computed status. Higher means
 * more trusted. Operators see the forecourt directly; a verified nearby user is
 * physically present; a remote user is repeating something second-hand.
 */
export const SOURCE_WEIGHTS = {
  OPERATOR: 1,
  ADMIN: 1,
  VERIFIED_NEARBY_USER: 0.7,
  NORMAL_USER: 0.35,
  SYSTEM_ESTIMATE: 0.2,
} as const;

/**
 * Reports older than this contribute nothing to the current status. They are
 * never deleted — they remain part of the historical record.
 */
export const STATUS_INPUT_WINDOW_MINUTES = 120;

/**
 * Recommendation tuning.
 *
 * Recommendation is a SEPARATE concern from list ordering: the default station
 * list stays nearest-first, and a recommendation is an annotation on top of it.
 */
export const RECOMMENDATION = {
  /**
   * Approximate city driving speed in km/h, used for travel time when no
   * routing API is configured. Deliberately conservative — the estimate is
   * presented as approximate, never as a routed ETA.
   */
  averageSpeedKmh: 22,
  /** Fixed minutes for parking, turning in and out, etc. */
  fixedTravelOverheadMinutes: 2,
  /**
   * A farther station must save at least this many minutes before it is
   * recommended over the nearest. Below this the saving is inside the noise of
   * the estimate and not worth sending someone further.
   */
  minMeaningfulSavingMinutes: 8,
  /** Never recommend a station below this confidence as the best choice. */
  minConfidenceToRecommend: 50,
  /** Freshness bands trustworthy enough to base a recommendation on. */
  acceptableFreshness: ['LIVE', 'RECENT', 'AGING'] as const,
  /** How many alternatives to surface alongside the recommendation. */
  maxAlternatives: 3,
  /**
   * Penalty minutes added to a station's effective time for a supply state that
   * is workable but risky, expressing "you might arrive and find nothing".
   */
  lowSupplyPenaltyMinutes: 6,
  interruptedPenaltyMinutes: 20,
  /** Penalty for a station whose queue is unknown — absence of data is a risk. */
  unknownQueuePenaltyMinutes: 5,
} as const;

/** Notification engine tuning. */
export const NOTIFICATIONS = {
  /** Default quiet period after a rule fires, overridable per rule. */
  defaultCooldownMinutes: 30,
  minCooldownMinutes: 5,
  maxCooldownMinutes: 24 * 60,
  /** Most rules one user may hold. */
  maxRulesPerUser: 50,
  /** Most push subscriptions (devices) one user may register. */
  maxSubscriptionsPerUser: 10,
  /**
   * A status this stale is not worth waking someone for — being told to drive
   * across town on half-hour-old data is worse than not being told at all.
   */
  minFreshnessToNotify: ['LIVE', 'RECENT'] as const,
  /** Confidence below this is too speculative to push. */
  minConfidenceToNotify: 40,
  /** Delivery attempts before an event is abandoned. */
  maxDeliveryAttempts: 3,
  /** Client route a notification opens. */
  deepLinkPattern: '/stations/{stationId}',
} as const;

export const PAGINATION = {
  defaultPage: 1,
  defaultLimit: 20,
  maxLimit: 100,
} as const;

/** Bounds for distance-based station discovery. */
export const GEO = {
  earthRadiusM: 6_371_000,
  defaultSearchRadiusM: 5_000,
  maxSearchRadiusM: 50_000,
} as const;
