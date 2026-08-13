import { Availability, Freshness, ReportSource } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { FRESHNESS_THRESHOLDS_MINUTES, REPUTATION } from '../src/config/constants';
import { confidenceService } from '../src/services/confidence.service';
import { freshnessService } from '../src/services/freshness.service';
import { reputationService } from '../src/services/reputation.service';
import { waitTimeService } from '../src/services/waitTime.service';
import { detectOutliers, median, medianAbsoluteDeviation } from '../src/utils/outliers';

/**
 * Pure-unit coverage for the Part 4 algorithms. No database — these functions
 * are deterministic by design, and testing them directly is what makes that
 * property enforceable.
 */

describe('FreshnessService', () => {
  it('applies the configured bands', () => {
    expect(freshnessService.classifyAge(0)).toBe(Freshness.LIVE);
    expect(freshnessService.classifyAge(4.9)).toBe(Freshness.LIVE);
    expect(freshnessService.classifyAge(5)).toBe(Freshness.RECENT);
    expect(freshnessService.classifyAge(14.9)).toBe(Freshness.RECENT);
    expect(freshnessService.classifyAge(15)).toBe(Freshness.AGING);
    expect(freshnessService.classifyAge(29.9)).toBe(Freshness.AGING);
    expect(freshnessService.classifyAge(30)).toBe(Freshness.STALE);
    expect(freshnessService.classifyAge(179)).toBe(Freshness.STALE);
  });

  it('reports data past the expiry cutoff as EXPIRED', () => {
    expect(freshnessService.classifyAge(FRESHNESS_THRESHOLDS_MINUTES.expired)).toBe(
      Freshness.EXPIRED,
    );
    expect(freshnessService.classifyAge(10_000)).toBe(Freshness.EXPIRED);
  });

  it('honours custom thresholds', () => {
    const thresholds = { live: 1, recent: 2, aging: 3, expired: 4 };
    expect(freshnessService.classifyAge(0.5, thresholds)).toBe(Freshness.LIVE);
    expect(freshnessService.classifyAge(2.5, thresholds)).toBe(Freshness.AGING);
    expect(freshnessService.classifyAge(5, thresholds)).toBe(Freshness.EXPIRED);
  });

  it('treats a missing or future timestamp as UNKNOWN, never LIVE', () => {
    expect(freshnessService.classify(null)).toBe(Freshness.UNKNOWN);
    expect(freshnessService.classify(undefined)).toBe(Freshness.UNKNOWN);

    const future = new Date(Date.now() + 60_000);
    expect(freshnessService.classify(future)).toBe(Freshness.UNKNOWN);
  });

  it('re-derives the band for a stored status as time passes', () => {
    const reportedAt = new Date('2026-08-07T10:00:00Z');

    const status = {
      freshness: Freshness.LIVE,
      lastOperatorUpdateAt: reportedAt,
      lastUserUpdateAt: null,
    };

    // Stale information must not continue appearing as live.
    expect(freshnessService.currentBandFor(status, new Date('2026-08-07T10:02:00Z'))).toBe(
      Freshness.LIVE,
    );
    expect(freshnessService.currentBandFor(status, new Date('2026-08-07T10:20:00Z'))).toBe(
      Freshness.AGING,
    );
    expect(freshnessService.currentBandFor(status, new Date('2026-08-07T11:00:00Z'))).toBe(
      Freshness.STALE,
    );
  });

  it('stays UNKNOWN when a status has no input timestamps', () => {
    const status = {
      freshness: Freshness.LIVE,
      lastOperatorUpdateAt: null,
      lastUserUpdateAt: null,
    };
    expect(freshnessService.currentBandFor(status, new Date())).toBe(Freshness.UNKNOWN);
  });

  it('refuses to present expired data as current', () => {
    const old = new Date(Date.now() - 300 * 60_000);
    expect(freshnessService.isPresentableAsCurrent(old)).toBe(false);
    expect(freshnessService.isPresentableAsCurrent(new Date())).toBe(true);
    expect(freshnessService.isPresentableAsCurrent(null)).toBe(false);
  });
});

describe('WaitTimeService', () => {
  it('keeps an unknown queue as an unknown wait, never zero', () => {
    const wait = waitTimeService.estimate({ min: null, max: null }, 4);
    expect(wait.min).toBeNull();
    expect(wait.max).toBeNull();
    expect(wait.min).not.toBe(0);
  });

  it('returns UNKNOWN when nothing is being served', () => {
    // Zero dispensers means the queue's duration is genuinely unknowable,
    // which is not the same as an instant wait.
    const wait = waitTimeService.estimate({ min: 8, max: 15 }, 0);
    expect(wait.min).toBeNull();
    expect(wait.max).toBeNull();
  });

  it('scales inversely with dispenser count', () => {
    const few = waitTimeService.estimate({ min: 16, max: 25 }, 2);
    const many = waitTimeService.estimate({ min: 16, max: 25 }, 8);
    expect(many.max!).toBeLessThan(few.max!);
  });

  it('grows with queue length', () => {
    const short = waitTimeService.estimate({ min: 0, max: 3 }, 4);
    const long = waitTimeService.estimate({ min: 16, max: 25 }, 4);
    expect(long.min!).toBeGreaterThan(short.min!);
    expect(long.max!).toBeGreaterThan(short.max!);
  });

  it('never returns false precision', () => {
    const wait = waitTimeService.estimate({ min: 7, max: 9 }, 3);

    // Rounded outward to the configured step, and never narrower than the
    // minimum spread — the queue input is a bucket, so a tight range would
    // claim more than the data supports.
    expect(wait.min! % 5).toBe(0);
    expect(wait.max! % 5).toBe(0);
    expect(wait.max! - wait.min!).toBeGreaterThanOrEqual(5);
  });

  it('includes fixed overhead so an empty queue is not a zero wait', () => {
    const wait = waitTimeService.estimate({ min: 0, max: 0 }, 4);
    expect(wait.max!).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = waitTimeService.estimate({ min: 8, max: 15 }, 3);
    const b = waitTimeService.estimate({ min: 8, max: 15 }, 3);
    expect(a).toEqual(b);
  });

  it('prefers an observed dispenser count over the configured total', () => {
    expect(waitTimeService.effectiveDispensers(2, 10)).toBe(2);
    // A reported zero is honoured, not replaced by the optimistic total.
    expect(waitTimeService.effectiveDispensers(0, 10)).toBe(0);
    expect(waitTimeService.effectiveDispensers(null, 10)).toBe(10);
    expect(waitTimeService.effectiveDispensers(null, null)).toBeNull();
  });
});

describe('ConfidenceService', () => {
  const base = {
    bestSourceWeight: 1,
    agreement: 1,
    freshness: Freshness.LIVE,
    distinctReporters: 3,
    outlierCount: 0,
    hasInput: true,
  };

  it('scores a fresh, unanimous, well-corroborated operator report near 100', () => {
    expect(confidenceService.score(base).score).toBeGreaterThanOrEqual(95);
  });

  it('returns zero when there is no input', () => {
    expect(confidenceService.score({ ...base, hasInput: false }).score).toBe(0);
    expect(confidenceService.score({ ...base, freshness: Freshness.UNKNOWN }).score).toBe(0);
  });

  it('falls as data ages', () => {
    const live = confidenceService.score(base).score;
    const recent = confidenceService.score({ ...base, freshness: Freshness.RECENT }).score;
    const aging = confidenceService.score({ ...base, freshness: Freshness.AGING }).score;
    const stale = confidenceService.score({ ...base, freshness: Freshness.STALE }).score;
    const expired = confidenceService.score({ ...base, freshness: Freshness.EXPIRED }).score;

    expect(live).toBeGreaterThan(recent);
    expect(recent).toBeGreaterThan(aging);
    expect(aging).toBeGreaterThan(stale);
    expect(stale).toBeGreaterThan(expired);
    // Expired data must never look confident, however good its sources were.
    expect(expired).toBeLessThan(15);
  });

  it('rewards a stronger source', () => {
    const operator = confidenceService.score(base).score;
    const remote = confidenceService.score({ ...base, bestSourceWeight: 0.35 }).score;
    expect(operator).toBeGreaterThan(remote);
  });

  it('rewards agreement and penalises conflict', () => {
    const unanimous = confidenceService.score(base).score;
    const split = confidenceService.score({ ...base, agreement: 0.5 }).score;
    expect(unanimous).toBeGreaterThan(split);
  });

  it('penalises detected outliers', () => {
    const clean = confidenceService.score(base).score;
    const conflicted = confidenceService.score({ ...base, outlierCount: 2 }).score;
    expect(conflicted).toBeLessThan(clean);
  });

  it('rewards independent corroboration', () => {
    const alone = confidenceService.score({ ...base, distinctReporters: 1 }).score;
    const corroborated = confidenceService.score({ ...base, distinctReporters: 3 }).score;
    expect(corroborated).toBeGreaterThan(alone);
  });

  it('exposes a component breakdown that explains the score', () => {
    const result = confidenceService.score(base);
    expect(result.components.source).toBeGreaterThan(0);
    expect(result.components.agreement).toBeGreaterThan(0);
    expect(result.components.freshness).toBeGreaterThan(0);
    expect(result.components.corroboration).toBeGreaterThan(0);
  });

  it('stays within 0-100 for extreme inputs', () => {
    const over = confidenceService.score({
      ...base,
      bestSourceWeight: 99,
      agreement: 99,
      distinctReporters: 999,
    });
    expect(over.score).toBeLessThanOrEqual(100);

    const under = confidenceService.score({
      ...base,
      bestSourceWeight: -5,
      agreement: -5,
      distinctReporters: 0,
    });
    expect(under.score).toBeGreaterThanOrEqual(0);
  });

  it('weights sources in the documented order', () => {
    expect(confidenceService.sourceWeight(ReportSource.OPERATOR)).toBeGreaterThan(
      confidenceService.sourceWeight(ReportSource.VERIFIED_NEARBY_USER),
    );
    expect(confidenceService.sourceWeight(ReportSource.VERIFIED_NEARBY_USER)).toBeGreaterThan(
      confidenceService.sourceWeight(ReportSource.NORMAL_USER),
    );
    expect(confidenceService.sourceWeight(ReportSource.ADMIN)).toBe(
      confidenceService.sourceWeight(ReportSource.OPERATOR),
    );
  });

  it('is deterministic', () => {
    expect(confidenceService.score(base)).toEqual(confidenceService.score(base));
  });
});

describe('Outlier detection', () => {
  it('computes median and MAD', () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1);
  });

  it('flags an obvious outlier', () => {
    const values = [5, 5, 6, 5, 5, 90];
    const result = detectOutliers(values);
    expect(result.isOutlier[5]).toBe(true);
    expect(result.outlierCount).toBe(1);
  });

  it('flags nothing when values agree', () => {
    const result = detectOutliers([5, 6, 5, 6, 5]);
    expect(result.outlierCount).toBe(0);
  });

  it('does not flag with too few samples', () => {
    // Two reports are a disagreement, not a consensus with a deviant.
    const result = detectOutliers([5, 90]);
    expect(result.outlierCount).toBe(0);
  });

  it('never flags an exempt authoritative source', () => {
    const values = [5, 5, 5, 5, 90];
    const exempt = [false, false, false, false, true];
    const result = detectOutliers(values, exempt);
    expect(result.isOutlier[4]).toBe(false);
    expect(result.outlierCount).toBe(0);
  });

  it('does not flag when every value is identical', () => {
    // A zero MAD would make any non-identical value infinitely deviant.
    const result = detectOutliers([7, 7, 7, 7, 7]);
    expect(result.outlierCount).toBe(0);
  });

  it('still detects when most samples are identical', () => {
    // MAD collapses to zero here because the majority are equal — the common
    // shape for bucketed queue reports. The mean-deviation fallback is what
    // keeps the wild value detectable.
    const result = detectOutliers([5, 5, 5, 5, 5, 6, 7, 200]);
    expect(result.isOutlier[7]).toBe(true);
    expect(result.isOutlier[5]).toBe(false);
    expect(result.isOutlier[6]).toBe(false);
  });

  it('treats a substantial minority as disagreement, not as outliers', () => {
    // A quarter of reporters saying something very different is a genuine
    // split — possibly the first sign of a change — so it is left to the
    // weighted consensus rather than being downweighted as noise.
    const result = detectOutliers([5, 5, 5, 5, 5, 5, 200, 200]);
    expect(result.outlierCount).toBe(0);
  });
});

describe('ReporterReputation', () => {
  it('starts neutral and moves gradually, never in one jump', () => {
    const start: number = REPUTATION.startingScore;
    const afterOne = reputationService.nextScore(start, 'AGREED_AND_VERIFIED');

    expect(afterOne).toBeGreaterThan(start);
    // One good report must not mint a fully trusted reporter.
    expect(afterOne).toBeLessThan(REPUTATION.targets.agreedAndVerified);
    expect(afterOne - start).toBeLessThan(10);
  });

  it('converges toward the target over many consistent reports', () => {
    let score: number = REPUTATION.startingScore;
    for (let i = 0; i < 60; i += 1) {
      score = reputationService.nextScore(score, 'AGREED_AND_VERIFIED');
    }
    expect(score).toBeGreaterThan(90);
  });

  it('falls for outlier behaviour without collapsing on one mistake', () => {
    const start = 80;
    const afterOne = reputationService.nextScore(start, 'OUTLIER');

    expect(afterOne).toBeLessThan(start);
    // A single bad report must not destroy a long-standing reporter.
    expect(afterOne).toBeGreaterThan(70);
  });

  it('separates disagreement from being an outlier', () => {
    const disagreed = reputationService.nextScore(50, 'DISAGREED');
    const outlier = reputationService.nextScore(50, 'OUTLIER');
    expect(outlier).toBeLessThan(disagreed);
  });

  it('stays inside 0-100', () => {
    let low = 0;
    for (let i = 0; i < 50; i += 1) low = reputationService.nextScore(low, 'OUTLIER');
    expect(low).toBeGreaterThanOrEqual(0);

    let high = 100;
    for (let i = 0; i < 50; i += 1) {
      high = reputationService.nextScore(high, 'AGREED_AND_VERIFIED');
    }
    expect(high).toBeLessThanOrEqual(100);
  });

  it('is deterministic', () => {
    expect(reputationService.nextScore(50, 'AGREED')).toBe(
      reputationService.nextScore(50, 'AGREED'),
    );
  });

  it('keeps a new reporter neutral rather than penalising inexperience', () => {
    expect(reputationService.weightMultiplier(null)).toBe(1);
    expect(
      reputationService.weightMultiplier({
        score: 95,
        totalReports: 1,
      } as never),
    ).toBe(1);
  });

  it('scales weight within the configured band once established', () => {
    const trusted = reputationService.weightMultiplier({
      score: 100,
      totalReports: 50,
    } as never);
    const poor = reputationService.weightMultiplier({
      score: 0,
      totalReports: 50,
    } as never);

    expect(trusted).toBeLessThanOrEqual(REPUTATION.weightInfluence.max);
    // Even a poor reporter keeps a voice — reputation modulates, never silences.
    expect(poor).toBeGreaterThanOrEqual(REPUTATION.weightInfluence.min);
    expect(poor).toBeGreaterThan(0);
    expect(trusted).toBeGreaterThan(poor);
  });
});

describe('Availability enum coverage', () => {
  it('scores every freshness band deterministically', () => {
    for (const freshness of Object.values(Freshness)) {
      const result = confidenceService.score({
        bestSourceWeight: 1,
        agreement: 1,
        freshness,
        distinctReporters: 3,
        outlierCount: 0,
        hasInput: true,
      });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
    expect(Object.values(Availability).length).toBeGreaterThan(0);
  });
});
