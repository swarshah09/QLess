import type { StationStatus } from '@prisma/client';
import { stationStateService, type RecomputeOptions } from './stationState.service';

/**
 * Thin facade over `stationStateService`, kept so Part 3's call sites
 * (`report.service`, `operatorReport.service`, the seed) keep working unchanged.
 *
 * The weighting, outlier handling, confidence, freshness and wait-time logic all
 * live in the dedicated services now — this only adapts the return shape.
 */
export const stationStatusService = {
  async recompute(
    stationId: string,
    now: Date = new Date(),
    options: Omit<RecomputeOptions, 'now'> = {},
  ): Promise<StationStatus> {
    const { status } = await stationStateService.recompute(stationId, { ...options, now });
    return status;
  },
};
