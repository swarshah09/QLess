import { Freshness, type ReportSource } from '@prisma/client';
import { SOURCE_WEIGHTS } from '../config/constants';

/**
 * Confidence scoring.
 *
 * Deterministic and explainable rather than learned — a driver deciding whether
 * to cross town deserves a number they can reason about, and an operator
 * deserves to know why their station reads the way it does.
 *
 * Four contributions, summing to 100:
 *   source      (40) how trustworthy the best contributing reporter was
 *   agreement   (25) how strongly the inputs corroborate each other
 *   freshness   (20) how recent the newest input is
 *   corroboration (15) how many independent reporters contributed
 */
export const CONFIDENCE_WEIGHTS = {
  source: 40,
  agreement: 25,
  freshness: 20,
  corroboration: 15,
} as const;

/** Independent reporters needed for full corroboration credit. */
export const FULL_CORROBORATION_REPORTERS = 3;

/** Multiplier applied to the final score for each freshness band. */
export const FRESHNESS_CONFIDENCE_FACTOR: Record<Freshness, number> = {
  [Freshness.LIVE]: 1,
  [Freshness.RECENT]: 0.9,
  [Freshness.AGING]: 0.7,
  [Freshness.STALE]: 0.4,
  // Expired data must never look confident, whatever its inputs were.
  [Freshness.EXPIRED]: 0.1,
  [Freshness.UNKNOWN]: 0,
};

export interface ConfidenceInput {
  /** Highest source weight among contributing reports (0..1). */
  bestSourceWeight: number;
  /** Share of total weight backing the chosen answer (0..1). */
  agreement: number;
  /** Freshness band of the newest contributing input. */
  freshness: Freshness;
  /** Distinct reporters that contributed. */
  distinctReporters: number;
  /** Reports discarded or downweighted as outliers. */
  outlierCount: number;
  /** False when nothing usable contributed at all. */
  hasInput: boolean;
}

export interface ConfidenceBreakdown {
  score: number;
  components: {
    source: number;
    agreement: number;
    freshness: number;
    corroboration: number;
  };
  freshnessFactor: number;
}

export const confidenceService = {
  /** Source weight for a report source, from the shared weighting table. */
  sourceWeight(source: ReportSource): number {
    return SOURCE_WEIGHTS[source] ?? 0.2;
  },

  /**
   * Scores 0-100 with a component breakdown, so a low score can always be
   * explained rather than merely asserted.
   */
  score(input: ConfidenceInput): ConfidenceBreakdown {
    const empty: ConfidenceBreakdown = {
      score: 0,
      components: { source: 0, agreement: 0, freshness: 0, corroboration: 0 },
      freshnessFactor: 0,
    };

    if (!input.hasInput || input.freshness === Freshness.UNKNOWN) return empty;

    const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

    const freshnessFactor = FRESHNESS_CONFIDENCE_FACTOR[input.freshness] ?? 0;

    const source = clamp01(input.bestSourceWeight) * CONFIDENCE_WEIGHTS.source;
    const agreement = clamp01(input.agreement) * CONFIDENCE_WEIGHTS.agreement;
    const freshness = freshnessFactor * CONFIDENCE_WEIGHTS.freshness;

    const corroboration =
      clamp01(input.distinctReporters / FULL_CORROBORATION_REPORTERS) *
      CONFIDENCE_WEIGHTS.corroboration;

    let total = source + agreement + freshness + corroboration;

    // Outliers mean the inputs conflict in a way the consensus had to discard;
    // that uncertainty should be visible in the score.
    if (input.outlierCount > 0 && input.distinctReporters > 0) {
      const outlierRatio = clamp01(input.outlierCount / input.distinctReporters);
      total *= 1 - 0.3 * outlierRatio;
    }

    // Applied last so ageing drags the whole score down, not just its own slice.
    // Without this a stale operator report would still read as highly confident.
    total *= freshnessFactor;

    return {
      score: Math.max(0, Math.min(100, Math.round(total))),
      components: {
        source: Math.round(source),
        agreement: Math.round(agreement),
        freshness: Math.round(freshness),
        corroboration: Math.round(corroboration),
      },
      freshnessFactor,
    };
  },
};
