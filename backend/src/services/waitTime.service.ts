import { WAIT_ESTIMATION } from '../config/constants';
import { isUnknownQueue, type QueueRange } from '../utils/queue';

/**
 * Wait-time estimation.
 *
 * Deterministic and configurable: the same queue, dispenser count and settings
 * always produce the same range. All assumptions live in `WAIT_ESTIMATION`.
 */

export interface WaitRange {
  min: number | null;
  max: number | null;
}

export const UNKNOWN_WAIT: WaitRange = { min: null, max: null };

export interface WaitAssumptions {
  minMinutesPerVehicle: number;
  maxMinutesPerVehicle: number;
  minFixedOverheadMinutes: number;
  maxFixedOverheadMinutes: number;
  fallbackDispensers: number;
  roundToMinutes: number;
  minimumSpreadMinutes: number;
}

/** Rounds a range outward, so the reported band never overstates certainty. */
function roundOutward(min: number, max: number, step: number): WaitRange {
  if (step <= 1) return { min: Math.round(min), max: Math.round(max) };
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step,
  };
}

export const waitTimeService = {
  /**
   * Estimates a wait range in minutes.
   *
   *   wait ≈ (vehicles ahead / dispensers) × fill time + fixed overhead
   *
   * Returns UNKNOWN — never a number — when the inputs cannot support one:
   *  - an unknown queue yields an unknown wait, never zero;
   *  - zero active dispensers means nothing is being served, so how long the
   *    queue will take is genuinely unknowable rather than instant.
   */
  estimate(
    queue: QueueRange,
    activeDispensers: number | null | undefined,
    assumptions: WaitAssumptions = WAIT_ESTIMATION,
  ): WaitRange {
    if (isUnknownQueue(queue)) return UNKNOWN_WAIT;

    if (activeDispensers !== null && activeDispensers !== undefined && activeDispensers <= 0) {
      return UNKNOWN_WAIT;
    }

    const dispensers =
      activeDispensers && activeDispensers > 0
        ? activeDispensers
        : assumptions.fallbackDispensers;

    const aheadMin = queue.min ?? queue.max!;
    const aheadMax = queue.max ?? queue.min!;

    const rawMin =
      (aheadMin / dispensers) * assumptions.minMinutesPerVehicle +
      assumptions.minFixedOverheadMinutes;
    const rawMax =
      (aheadMax / dispensers) * assumptions.maxMinutesPerVehicle +
      assumptions.maxFixedOverheadMinutes;

    const rounded = roundOutward(rawMin, rawMax, assumptions.roundToMinutes);

    const min = Math.max(0, rounded.min ?? 0);
    let max = Math.max(min, rounded.max ?? 0);

    // The queue itself is a bucket, so a narrow output would be false
    // precision. Widen upward rather than pretending to a tighter estimate.
    if (max - min < assumptions.minimumSpreadMinutes) {
      max = min + assumptions.minimumSpreadMinutes;
    }

    return { min, max };
  },

  /**
   * Chooses the dispenser count to estimate with.
   *
   * An operator-observed count is authoritative. Falling back to the station's
   * configured total is optimistic, so it is only used when nothing has been
   * observed — and a reported zero is honoured, never replaced by the total.
   */
  effectiveDispensers(
    observed: number | null | undefined,
    configuredTotal: number | null | undefined,
  ): number | null {
    if (observed !== null && observed !== undefined) return observed;
    if (configuredTotal && configuredTotal > 0) return configuredTotal;
    return null;
  },
};
