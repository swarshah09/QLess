import {
  Availability,
  type AvailabilityReport,
  Freshness,
  PressureUnit,
  type PressureReport,
  type QueueReport,
  type ReportSource,
  type StationStatus,
} from '@prisma/client';
import {
  OUTLIER_DETECTION,
  STATUS_INPUT_WINDOW_MINUTES,
} from '../config/constants';
import { AppError } from '../errors/AppError';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { notificationService } from '../notifications/notification.service';
import { getRealtimeGateway } from '../sockets/realtime.gateway';
import { reportRepository } from '../repositories/report.repository';
import { stationRepository } from '../repositories/station.repository';
import { stationStatusRepository } from '../repositories/stationStatus.repository';
import { statusSnapshotRepository } from '../repositories/statusSnapshot.repository';
import { classifyPressure, toBar } from '../utils/pressure';
import {
  UNKNOWN_QUEUE,
  bucketForRange,
  isUnknownQueue,
  type QueueRange,
} from '../utils/queue';
import { detectOutliers, outlierWeightFactor } from '../utils/outliers';
import { confidenceService } from './confidence.service';
import { freshnessService } from './freshness.service';
import { reputationService, type ReportBehaviour } from './reputation.service';
import { waitTimeService } from './waitTime.service';

/**
 * Derives a station's current state from its recent raw reports.
 *
 * The rule this service exists to enforce: NEVER just take the latest report.
 * Every answer is a weighted consensus over the input window, where each report
 * is scaled by its source, its age, its reporter's reliability, and whether it
 * agrees with everything else.
 *
 * Raw reports are only ever read. The single mutable output is `StationStatus`,
 * plus an append-only snapshot of what was produced.
 */

type ReportLike = { source: ReportSource; createdAt: Date; userId: string | null };

interface WeightedSample<T> {
  report: T;
  weight: number;
  isOutlier: boolean;
}

/** Per-report weight before outlier adjustment. */
interface WeightingContext {
  now: Date;
  windowMinutes: number;
  reputationMultipliers: Map<string, number>;
}

function isAuthoritative(source: ReportSource): boolean {
  return (OUTLIER_DETECTION.exemptSources as readonly string[]).includes(source);
}

/** Linear decay to zero across the window: old reports fade, never jump to nil. */
function recencyWeight(createdAt: Date, ctx: WeightingContext): number {
  const ageMinutes = (ctx.now.getTime() - createdAt.getTime()) / 60_000;
  if (ageMinutes <= 0) return 1;
  if (ageMinutes >= ctx.windowMinutes) return 0;
  return 1 - ageMinutes / ctx.windowMinutes;
}

/**
 * Combined weight: source trust × recency × reporter reliability.
 *
 * Reputation is applied here rather than baked into the source weight so the
 * two stay independently tunable — and so a poor-reputation operator is still
 * an operator.
 */
function baseWeight(report: ReportLike, ctx: WeightingContext): number {
  const source = confidenceService.sourceWeight(report.source);
  const recency = recencyWeight(report.createdAt, ctx);
  const reputation = report.userId
    ? (ctx.reputationMultipliers.get(report.userId) ?? 1)
    : 1;

  return source * recency * reputation;
}

/** Applies outlier detection over a numeric projection of the reports. */
function weighSamples<T extends ReportLike>(
  reports: T[],
  valueOf: (report: T) => number,
  ctx: WeightingContext,
): { samples: WeightedSample<T>[]; outlierCount: number } {
  const usable = reports.filter((report) => baseWeight(report, ctx) > 0);

  if (usable.length === 0) return { samples: [], outlierCount: 0 };

  const flags = detectOutliers(
    usable.map(valueOf),
    usable.map((report) => isAuthoritative(report.source)),
  );

  const samples = usable.map((report, index) => ({
    report,
    weight:
      baseWeight(report, ctx) * outlierWeightFactor(flags.isOutlier[index]),
    isOutlier: flags.isOutlier[index],
  }));

  return { samples, outlierCount: flags.outlierCount };
}

function distinctReporters(reports: ReportLike[]): number {
  return new Set(reports.map((r) => r.userId).filter(Boolean)).size;
}

function newestTimestamp(reports: ReportLike[]): Date | null {
  return reports.length === 0
    ? null
    : reports
        .map((r) => r.createdAt)
        .reduce((latest, d) => (d > latest ? d : latest));
}

// ---------------------------------------------------------------------------
// Dimension resolvers
// ---------------------------------------------------------------------------

interface AvailabilityResolution {
  availability: Availability;
  agreement: number;
  totalWeight: number;
  outlierCount: number;
  /** Which reports agreed with the outcome, for reputation scoring. */
  behaviours: Map<string, ReportBehaviour>;
}

/**
 * Weighted vote across availability reports.
 *
 * An operator's most recent statement wins outright rather than counting as one
 * vote: they are describing their own forecourt, and letting slightly older
 * crowd reports out-vote them would keep sending drivers to an empty station.
 */
function resolveAvailability(
  reports: AvailabilityReport[],
  ctx: WeightingContext,
): AvailabilityResolution {
  const behaviours = new Map<string, ReportBehaviour>();

  const stated = reports.filter(
    (report) =>
      report.availability !== Availability.UNKNOWN && baseWeight(report, ctx) > 0,
  );

  if (stated.length === 0) {
    return {
      availability: Availability.UNKNOWN,
      agreement: 0,
      totalWeight: 0,
      outlierCount: 0,
      behaviours,
    };
  }

  const authoritative = stated
    .filter((report) => isAuthoritative(report.source))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const weightFor = (report: AvailabilityReport) => baseWeight(report, ctx);
  const totalWeight = stated.reduce((sum, report) => sum + weightFor(report), 0);

  let winner: Availability;

  if (authoritative.length > 0) {
    winner = authoritative[0].availability;
  } else {
    const tally = new Map<Availability, number>();
    for (const report of stated) {
      tally.set(
        report.availability,
        (tally.get(report.availability) ?? 0) + weightFor(report),
      );
    }

    winner = Availability.UNKNOWN;
    let best = 0;
    for (const [availability, weight] of tally) {
      if (weight > best) {
        winner = availability;
        best = weight;
      }
    }
  }

  const agreeingWeight = stated
    .filter((report) => report.availability === winner)
    .reduce((sum, report) => sum + weightFor(report), 0);

  // Availability is categorical, so "outlier" means disagreeing with a
  // consensus strong enough to be worth trusting.
  let outlierCount = 0;
  const consensusStrength = totalWeight > 0 ? agreeingWeight / totalWeight : 0;

  for (const report of stated) {
    if (!report.userId) continue;

    if (report.availability === winner) {
      behaviours.set(
        report.userId,
        report.locationVerified ? 'AGREED_AND_VERIFIED' : 'AGREED',
      );
    } else if (consensusStrength >= 0.75 && stated.length >= OUTLIER_DETECTION.minSamplesToDetect) {
      behaviours.set(report.userId, 'OUTLIER');
      outlierCount += 1;
    } else {
      behaviours.set(report.userId, 'DISAGREED');
    }
  }

  return {
    availability: winner,
    agreement: totalWeight > 0 ? agreeingWeight / totalWeight : 0,
    totalWeight,
    outlierCount,
    behaviours,
  };
}

interface QueueResolution {
  queue: QueueRange;
  totalWeight: number;
  outlierCount: number;
  sampleCount: number;
}

/**
 * Weighted average of reported queue bounds, producing a RANGE.
 *
 * Reports where the user chose "not sure" carry no bounds and are skipped
 * entirely — never counted as zero — so a station nobody can see stays UNKNOWN
 * rather than appearing empty.
 */
function resolveQueue(reports: QueueReport[], ctx: WeightingContext): QueueResolution {
  const known = reports.filter(
    (report) => report.queueMin !== null || report.queueMax !== null,
  );

  const { samples, outlierCount } = weighSamples(
    known,
    // Midpoint is the outlier axis: a report of "0-3" against a consensus of
    // "16-25" should be judged on where it sits, not on its width.
    (report) => {
      const min = report.queueMin ?? report.queueMax!;
      const max = report.queueMax ?? report.queueMin!;
      return (min + max) / 2;
    },
    ctx,
  );

  let weightedMin = 0;
  let weightedMax = 0;
  let totalWeight = 0;

  for (const { report, weight } of samples) {
    if (weight <= 0) continue;
    const min = report.queueMin ?? report.queueMax!;
    const max = report.queueMax ?? report.queueMin!;
    weightedMin += min * weight;
    weightedMax += max * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return { queue: UNKNOWN_QUEUE, totalWeight: 0, outlierCount, sampleCount: 0 };
  }

  const min = Math.round(weightedMin / totalWeight);
  const max = Math.round(weightedMax / totalWeight);

  return {
    // Ordering is defended explicitly: rounding two independent weighted means
    // can otherwise invert them when reports disagree about width.
    queue: { min: Math.min(min, max), max: Math.max(min, max) },
    totalWeight,
    outlierCount,
    sampleCount: samples.length,
  };
}

interface PressureResolution {
  valueBar: number | null;
  totalWeight: number;
  outlierCount: number;
  sampleCount: number;
}

/** Weighted average pressure, normalised to bar for comparability. */
function resolvePressure(
  reports: PressureReport[],
  ctx: WeightingContext,
): PressureResolution {
  const { samples, outlierCount } = weighSamples(
    reports,
    (report) => toBar(report.pressureValue, report.pressureUnit),
    ctx,
  );

  let weightedSum = 0;
  let totalWeight = 0;

  for (const { report, weight } of samples) {
    if (weight <= 0) continue;
    weightedSum += toBar(report.pressureValue, report.pressureUnit) * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return { valueBar: null, totalWeight: 0, outlierCount, sampleCount: 0 };
  }

  return {
    // One decimal: the inputs are eyeballed gauge readings, so more would be
    // false precision.
    valueBar: Math.round((weightedSum / totalWeight) * 10) / 10,
    totalWeight,
    outlierCount,
    sampleCount: samples.length,
  };
}

/** Most recent operator-observed dispenser count within the window. */
function resolveActiveDispensers(reports: AvailabilityReport[]): number | null {
  const withCount = reports
    .filter((report) => report.activeDispensers !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return withCount[0]?.activeDispensers ?? null;
}

function latestBySource(
  reports: ReportLike[],
  predicate: (source: ReportSource) => boolean,
): Date | null {
  const matching = reports.filter((report) => predicate(report.source));
  return newestTimestamp(matching);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface RecomputeOptions {
  now?: Date;
  windowMinutes?: number;
  /** Snapshot the result for historical analysis. Default true. */
  snapshot?: boolean;
  /** Update reporter reputations from this computation. Default true. */
  updateReputation?: boolean;
  /**
   * Evaluate this station's notification rules against the new status.
   * Default true — a status change is exactly when alerts should be checked.
   */
  evaluateNotifications?: boolean;
  /** Broadcast the new status to subscribed sockets. Default true. */
  emitRealtime?: boolean;
}

export interface RecomputeResult {
  status: StationStatus;
  outlierCount: number;
  confidenceBreakdown: ReturnType<typeof confidenceService.score>;
}

export const stationStateService = {
  /**
   * Recomputes and persists a station's state from its recent reports.
   *
   * Safe to call as often as needed: it reads history and writes only derived
   * data. Called after every report and operator update so the projection never
   * lags its inputs.
   */
  async recompute(
    stationId: string,
    options: RecomputeOptions = {},
  ): Promise<RecomputeResult> {
    const now = options.now ?? new Date();
    const windowMinutes = options.windowMinutes ?? STATUS_INPUT_WINDOW_MINUTES;

    const station = await stationRepository.findById(stationId);
    if (!station) throw AppError.notFound('Station not found');

    const since = new Date(now.getTime() - windowMinutes * 60_000);

    const [queueReports, availabilityReports, pressureReports] = await Promise.all([
      reportRepository.recentQueueReports(stationId, since),
      reportRepository.recentAvailabilityReports(stationId, since),
      reportRepository.recentPressureReports(stationId, since),
    ]);

    const allReports: ReportLike[] = [
      ...queueReports,
      ...availabilityReports,
      ...pressureReports,
    ];

    const reporterIds = allReports
      .map((report) => report.userId)
      .filter((id): id is string => id !== null);

    const ctx: WeightingContext = {
      now,
      windowMinutes,
      reputationMultipliers: await reputationService.multipliersFor(reporterIds),
    };

    const availability = resolveAvailability(availabilityReports, ctx);
    const queue = resolveQueue(queueReports, ctx);
    const pressure = resolvePressure(pressureReports, ctx);
    const observedDispensers = resolveActiveDispensers(availabilityReports);

    const wait = waitTimeService.estimate(
      queue.queue,
      waitTimeService.effectiveDispensers(observedDispensers, station.numberOfDispensers),
    );

    // Classification always relative to the station's own configured
    // thresholds, never a global constant.
    const pressureStatus = classifyPressure(pressure.valueBar, PressureUnit.BAR, station);

    const newestInputAt = newestTimestamp(allReports);
    const freshness = freshnessService.classify(newestInputAt, now);

    const hasInput =
      availability.totalWeight > 0 || queue.totalWeight > 0 || pressure.totalWeight > 0;

    const bestSourceWeight = allReports.reduce((best, report) => {
      if (recencyWeight(report.createdAt, ctx) <= 0) return best;
      return Math.max(best, confidenceService.sourceWeight(report.source));
    }, 0);

    const outlierCount =
      availability.outlierCount + queue.outlierCount + pressure.outlierCount;

    const confidenceBreakdown = confidenceService.score({
      bestSourceWeight,
      // With no availability reports there is nothing to agree about; treat it
      // as neutral rather than crediting or penalising consensus.
      agreement: availability.totalWeight > 0 ? availability.agreement : 0.5,
      freshness,
      distinctReporters: distinctReporters(allReports),
      outlierCount,
      hasInput,
    });

    const status = await stationStatusRepository.upsert({
      stationId,
      availability: availability.availability,
      queueMin: queue.queue.min,
      queueMax: queue.queue.max,
      queueBucket: isUnknownQueue(queue.queue)
        ? bucketForRange(UNKNOWN_QUEUE)
        : bucketForRange(queue.queue),
      waitMin: wait.min,
      waitMax: wait.max,
      pressureValue: pressure.valueBar,
      pressureUnit: PressureUnit.BAR,
      pressureStatus,
      activeDispensers: observedDispensers,
      confidence: confidenceBreakdown.score,
      freshness,
      computedAt: now,
      lastOperatorUpdateAt: latestBySource(
        allReports,
        (source) => source === 'OPERATOR' || source === 'ADMIN',
      ),
      lastUserUpdateAt: latestBySource(
        allReports,
        (source) => source === 'VERIFIED_NEARBY_USER' || source === 'NORMAL_USER',
      ),
    });

    if (options.snapshot !== false) {
      await statusSnapshotRepository.record({
        stationId,
        status,
        queueSampleCount: queue.sampleCount,
        availabilitySampleCount: availabilityReports.length,
        pressureSampleCount: pressure.sampleCount,
        outlierCount,
      });
    }

    if (options.updateReputation !== false && availability.behaviours.size > 0) {
      await reputationService.recordMany(
        [...availability.behaviours.entries()].map(([userId, behaviour]) => ({
          userId,
          behaviour,
          reportedAt: now,
        })),
      );
    }

    if (options.emitRealtime !== false) {
      // Fire-and-forget to the station's room. The gateway is a no-op when no
      // socket server is running, so this is safe in tests, seeds and CLI runs.
      getRealtimeGateway().emitStationUpdated(status);
    }

    if (options.evaluateNotifications !== false) {
      // Scoped to this station only — a status change here cannot affect a rule
      // watching anywhere else, so there is never a global rule scan.
      //
      // Failures are swallowed: the status computation is the primary work and
      // must not be undone because a push could not be sent.
      try {
        await notificationService.evaluateStation(stationId, { now, status });
      } catch (error) {
        logger.error(
          { err: error, stationId },
          'Notification evaluation failed after status recompute',
        );
      }
    }

    return { status, outlierCount, confidenceBreakdown };
  },

  /**
   * Returns a stored status with its freshness and confidence re-derived for
   * the current moment.
   *
   * This is the lightweight decay mechanism: no background job is required for
   * a status to stop reading as live. A status written as LIVE forty minutes
   * ago is served as STALE, with confidence scaled down to match, because read
   * paths re-derive both from the age of the underlying inputs.
   */
  decay(status: StationStatus, now: Date = new Date()): StationStatus {
    const currentFreshness = freshnessService.currentBandFor(status, now);
    if (currentFreshness === status.freshness) return status;

    const previousFactor =
      confidenceService.score({
        bestSourceWeight: 1,
        agreement: 1,
        freshness: status.freshness,
        distinctReporters: 3,
        outlierCount: 0,
        hasInput: true,
      }).freshnessFactor || 1;

    const nextFactor = confidenceService.score({
      bestSourceWeight: 1,
      agreement: 1,
      freshness: currentFreshness,
      distinctReporters: 3,
      outlierCount: 0,
      hasInput: true,
    }).freshnessFactor;

    return {
      ...status,
      freshness: currentFreshness,
      // Rescaled by the ratio of freshness factors so a status that has aged
      // out of LIVE also stops claiming the confidence it had when live.
      confidence: Math.max(
        0,
        Math.min(100, Math.round((status.confidence / previousFactor) * nextFactor)),
      ),
    };
  },

  /** Recomputes several stations. Used by seeds and maintenance jobs. */
  async recomputeMany(stationIds: string[], options: RecomputeOptions = {}) {
    const results: RecomputeResult[] = [];
    for (const stationId of stationIds) {
      results.push(await this.recompute(stationId, options));
    }
    return results;
  },

  /**
   * Recomputes every station whose status has aged past a freshness band.
   *
   * Optional housekeeping — `decay()` already keeps read paths honest without
   * it — but running it periodically keeps the stored rows consistent with what
   * clients are shown.
   */
  async refreshStaleStatuses(options: RecomputeOptions = {}): Promise<number> {
    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - STATUS_INPUT_WINDOW_MINUTES * 60_000);

    const stale = await prisma.stationStatus.findMany({
      where: {
        computedAt: { lt: cutoff },
        freshness: { notIn: [Freshness.EXPIRED, Freshness.UNKNOWN] },
      },
      select: { stationId: true },
    });

    await this.recomputeMany(
      stale.map((row) => row.stationId),
      options,
    );

    return stale.length;
  },
};
