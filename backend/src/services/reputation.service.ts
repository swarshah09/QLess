import type { ReporterReputation } from '@prisma/client';
import { REPUTATION } from '../config/constants';
import { reputationRepository } from '../repositories/reputation.repository';

/**
 * Reporter reliability.
 *
 * Scores move GRADUALLY: each observation nudges the score a fraction of the
 * way toward a target rather than setting it. One mistake should not destroy a
 * long-standing reporter, and one lucky report should not mint a trusted one.
 * Fully deterministic — the same history always yields the same score.
 */

/** How a single report behaved relative to the consensus around it. */
export type ReportBehaviour =
  | 'AGREED_AND_VERIFIED'
  | 'AGREED'
  | 'NEUTRAL'
  | 'DISAGREED'
  | 'OUTLIER';

export interface ReputationOutcome {
  userId: string;
  behaviour: ReportBehaviour;
  reportedAt: Date;
}

function targetFor(behaviour: ReportBehaviour): number {
  switch (behaviour) {
    case 'AGREED_AND_VERIFIED':
      return REPUTATION.targets.agreedAndVerified;
    case 'AGREED':
      return REPUTATION.targets.agreed;
    case 'DISAGREED':
      return REPUTATION.targets.disagreed;
    case 'OUTLIER':
      return REPUTATION.targets.outlier;
    case 'NEUTRAL':
    default:
      return REPUTATION.targets.neutral;
  }
}

export const reputationService = {
  /**
   * Next score after one observation.
   *
   * Exponential move toward the target: `next = current + rate × (target −
   * current)`. Pure and deterministic, so it can be unit-tested and reasoned
   * about without a database.
   */
  nextScore(currentScore: number, behaviour: ReportBehaviour): number {
    const target = targetFor(behaviour);
    const moved = currentScore + REPUTATION.learningRate * (target - currentScore);

    return Math.max(
      REPUTATION.minScore,
      Math.min(REPUTATION.maxScore, Math.round(moved)),
    );
  },

  /**
   * Multiplier a reporter's standing contributes to their report's weight.
   *
   * Bounded by `weightInfluence` so reputation modulates trust without ever
   * silencing someone or letting one trusted user override everyone else. A
   * reporter with too little history stays neutral (1.0) rather than being
   * penalised for being new.
   */
  weightMultiplier(reputation: ReporterReputation | null | undefined): number {
    if (!reputation || reputation.totalReports < REPUTATION.minReportsForInfluence) {
      return 1;
    }

    const { min, max } = REPUTATION.weightInfluence;
    const normalized = Math.max(0, Math.min(1, reputation.score / REPUTATION.maxScore));

    return min + normalized * (max - min);
  },

  /** Applies one observation and persists the result. */
  async record(outcome: ReputationOutcome): Promise<ReporterReputation> {
    const existing = await reputationRepository.findByUserId(outcome.userId);
    const currentScore = existing?.score ?? REPUTATION.startingScore;
    const score = this.nextScore(currentScore, outcome.behaviour);

    return reputationRepository.applyOutcome({
      userId: outcome.userId,
      score,
      agreed:
        outcome.behaviour === 'AGREED' || outcome.behaviour === 'AGREED_AND_VERIFIED',
      rejected: outcome.behaviour === 'OUTLIER',
      reportedAt: outcome.reportedAt,
    });
  },

  /** Applies several observations, one per reporter. */
  async recordMany(outcomes: ReputationOutcome[]): Promise<void> {
    // Sequential rather than parallel: two outcomes for the same user in one
    // batch must compound, and concurrent upserts would let one overwrite the
    // other's score.
    for (const outcome of outcomes) {
      await this.record(outcome);
    }
  },

  async multipliersFor(userIds: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(userIds)];
    const reputations = await reputationRepository.findManyByUserIds(unique);
    const byUser = new Map(reputations.map((r) => [r.userId, r]));

    return new Map(
      unique.map((userId) => [userId, this.weightMultiplier(byUser.get(userId))]),
    );
  },
};
