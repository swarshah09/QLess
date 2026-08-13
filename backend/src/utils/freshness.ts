import type { Freshness } from '@prisma/client';
import { freshnessService } from '../services/freshness.service';

/**
 * Derives how trustworthy-by-age a computed status is from the timestamp of
 * its newest input. No timestamp means UNKNOWN, never LIVE.
 *
 * Delegates to `freshnessService` so there is one banding implementation.
 */
export function freshnessFor(
  lastUpdateAt: Date | null | undefined,
  now: Date = new Date(),
): Freshness {
  return freshnessService.classify(lastUpdateAt, now);
}

/** Most recent of a set of possibly-null timestamps. */
export function mostRecent(...dates: Array<Date | null | undefined>): Date | null {
  const valid = dates.filter((d): d is Date => d instanceof Date);
  if (valid.length === 0) return null;
  return valid.reduce((latest, d) => (d > latest ? d : latest));
}
