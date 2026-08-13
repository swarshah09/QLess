import { OUTLIER_DETECTION } from '../config/constants';

/**
 * Outlier detection by modified z-score (median absolute deviation).
 *
 * MAD is used rather than mean/standard deviation because it is resistant to
 * the very values it is meant to find: two wild reports can drag a mean far
 * enough that neither looks unusual, whereas the median barely moves.
 *
 * Detected outliers are DOWNWEIGHTED, never dropped. A lone dissenter may be
 * the first person to notice a change, so their report keeps a voice — just a
 * quieter one.
 */

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median of absolute deviations from the median. */
export function medianAbsoluteDeviation(values: number[], centre?: number): number {
  if (values.length === 0) return 0;
  const mid = centre ?? median(values);
  return median(values.map((value) => Math.abs(value - mid)));
}

/** Mean of absolute deviations from the median. */
export function meanAbsoluteDeviation(values: number[], centre?: number): number {
  if (values.length === 0) return 0;
  const mid = centre ?? median(values);
  const total = values.reduce((sum, value) => sum + Math.abs(value - mid), 0);
  return total / values.length;
}

/**
 * Consistency constants that put each deviation measure on the same scale as a
 * standard deviation, so one threshold applies to both.
 */
const MAD_SCALE = 0.6745;
const MEAN_AD_SCALE = 0.7979;

export interface OutlierFlags {
  /** Parallel to the input: true where the value is an outlier. */
  isOutlier: boolean[];
  outlierCount: number;
  median: number;
  mad: number;
}

/**
 * Flags outliers among numeric samples.
 *
 * `exempt[i]` marks a sample that can never be flagged — authoritative sources
 * define the truth rather than deviating from it.
 */
export function detectOutliers(
  values: number[],
  exempt: boolean[] = [],
  config = OUTLIER_DETECTION,
): OutlierFlags {
  const centre = median(values);
  const mad = medianAbsoluteDeviation(values, centre);

  const none: OutlierFlags = {
    isOutlier: values.map(() => false),
    outlierCount: 0,
    median: centre,
    mad,
  };

  // Too few samples for a meaningful consensus to deviate from.
  if (values.length < config.minSamplesToDetect) return none;

  /**
   * MAD collapses to zero whenever more than half the samples are identical —
   * which is the common case here, since queue reports come from a small set of
   * buckets. Falling back to the mean absolute deviation keeps detection
   * working for exactly the data this system sees; without it a lone wild
   * report among five identical ones would never be flagged.
   */
  const useMad = mad > 0;
  const spread = useMad ? mad : meanAbsoluteDeviation(values, centre);
  const scale = useMad ? MAD_SCALE : MEAN_AD_SCALE;

  // Every value identical: there is no deviation to measure, and dividing by
  // zero would flag any non-identical value however reasonable.
  if (spread === 0) return none;

  const isOutlier = values.map((value, index) => {
    if (exempt[index]) return false;
    const modifiedZ = (scale * Math.abs(value - centre)) / spread;
    return modifiedZ > config.madThreshold;
  });

  return {
    isOutlier,
    outlierCount: isOutlier.filter(Boolean).length,
    median: centre,
    mad,
  };
}

/** Weight multiplier for a sample given its outlier flag. */
export function outlierWeightFactor(isOutlier: boolean, config = OUTLIER_DETECTION): number {
  return isOutlier ? config.downweightFactor : 1;
}
