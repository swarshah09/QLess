import { Freshness } from '@prisma/client';
import { FRESHNESS_THRESHOLDS_MINUTES } from '../config/constants';

/**
 * Freshness classification.
 *
 * Bands come from `FRESHNESS_THRESHOLDS_MINUTES` so cutoffs are tunable in one
 * place. Deterministic: the same timestamp and clock always yield the same band.
 */

export interface FreshnessThresholds {
  live: number;
  recent: number;
  aging: number;
  expired: number;
}

export const freshnessService = {
  /**
   * Band for an age in minutes.
   *
   * A negative age (a clock skew, or a timestamp from the future) is UNKNOWN
   * rather than LIVE — data we cannot place in time must not be presented as
   * the freshest thing we have.
   */
  classifyAge(
    ageMinutes: number,
    thresholds: FreshnessThresholds = FRESHNESS_THRESHOLDS_MINUTES,
  ): Freshness {
    if (!Number.isFinite(ageMinutes) || ageMinutes < 0) return Freshness.UNKNOWN;

    if (ageMinutes < thresholds.live) return Freshness.LIVE;
    if (ageMinutes < thresholds.recent) return Freshness.RECENT;
    if (ageMinutes < thresholds.aging) return Freshness.AGING;
    if (ageMinutes < thresholds.expired) return Freshness.STALE;
    return Freshness.EXPIRED;
  },

  /** Band for a timestamp. No timestamp means UNKNOWN, never LIVE. */
  classify(
    lastUpdateAt: Date | null | undefined,
    now: Date = new Date(),
    thresholds: FreshnessThresholds = FRESHNESS_THRESHOLDS_MINUTES,
  ): Freshness {
    if (!lastUpdateAt) return Freshness.UNKNOWN;
    return this.classifyAge(
      (now.getTime() - lastUpdateAt.getTime()) / 60_000,
      thresholds,
    );
  },

  /** Age in minutes, or null when there is no timestamp. */
  ageMinutes(lastUpdateAt: Date | null | undefined, now: Date = new Date()): number | null {
    if (!lastUpdateAt) return null;
    return (now.getTime() - lastUpdateAt.getTime()) / 60_000;
  },

  /**
   * Whether a status may still be presented as describing the station now.
   *
   * This is the lightweight decay mechanism: a stored status becomes stale by
   * the passage of time alone, with no new report and no background job. Any
   * read path can call this and re-derive the current band, so nothing that has
   * aged out keeps being served as live.
   */
  isPresentableAsCurrent(
    computedFrom: Date | null | undefined,
    now: Date = new Date(),
    thresholds: FreshnessThresholds = FRESHNESS_THRESHOLDS_MINUTES,
  ): boolean {
    const band = this.classify(computedFrom, now, thresholds);
    return band !== Freshness.EXPIRED && band !== Freshness.UNKNOWN;
  },

  /**
   * Re-derives the freshness a stored status should show right now.
   *
   * A status computed 40 minutes ago was written as LIVE; read today it must
   * read STALE. Callers use this instead of trusting the persisted column.
   */
  currentBandFor(
    status: { freshness: Freshness; lastOperatorUpdateAt: Date | null; lastUserUpdateAt: Date | null },
    now: Date = new Date(),
    thresholds: FreshnessThresholds = FRESHNESS_THRESHOLDS_MINUTES,
  ): Freshness {
    const newest = [status.lastOperatorUpdateAt, status.lastUserUpdateAt]
      .filter((d): d is Date => d instanceof Date)
      .reduce<Date | null>((latest, d) => (!latest || d > latest ? d : latest), null);

    // No input timestamps at all: the status was computed from nothing, so it
    // stays UNKNOWN however recently the computation itself ran.
    if (!newest) return Freshness.UNKNOWN;

    return this.classify(newest, now, thresholds);
  },
};
