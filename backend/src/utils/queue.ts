import { QueueBucket } from '@prisma/client';
import { QUEUE_BUCKETS } from '../config/constants';

export interface QueueRange {
  min: number | null;
  max: number | null;
}

/** An unknown queue: both bounds null. This is NOT the same as a queue of 0. */
export const UNKNOWN_QUEUE: QueueRange = { min: null, max: null };

export function isUnknownQueue(range: QueueRange | null | undefined): boolean {
  return !range || (range.min === null && range.max === null);
}

/** Maps an observed count onto the canonical bucket it falls into. */
export function bucketForCount(count: number | null | undefined): QueueBucket {
  if (count === null || count === undefined || Number.isNaN(count)) {
    return QueueBucket.UNKNOWN;
  }
  const match = QUEUE_BUCKETS.find(
    (b) => b.min !== null && count >= b.min && (b.max === null || count <= b.max),
  );
  return match?.bucket ?? QueueBucket.UNKNOWN;
}

/**
 * Maps a reported [min, max] range onto a bucket. When the range straddles
 * bucket boundaries we take the bucket containing its midpoint, which keeps
 * wide ranges from always collapsing to the smallest bucket.
 */
export function bucketForRange(range: QueueRange): QueueBucket {
  if (isUnknownQueue(range)) return QueueBucket.UNKNOWN;
  const min = range.min ?? range.max!;
  const max = range.max ?? range.min!;
  return bucketForCount(Math.round((min + max) / 2));
}

/** Expands a bucket back into its numeric range. UNKNOWN stays null/null. */
export function rangeForBucket(bucket: QueueBucket): QueueRange {
  const match = QUEUE_BUCKETS.find((b) => b.bucket === bucket);
  return match ? { min: match.min, max: match.max } : UNKNOWN_QUEUE;
}

/** Human-facing label, e.g. "4-7" or "25+". Never renders unknown as "0". */
export function labelForBucket(bucket: QueueBucket): string {
  return QUEUE_BUCKETS.find((b) => b.bucket === bucket)?.label ?? 'Unknown';
}

/** The wire labels clients submit, e.g. `{ "queueRange": "4-7" }`. */
export const QUEUE_RANGE_LABELS = [
  '0-3',
  '4-7',
  '8-15',
  '16-25',
  '25+',
  'UNKNOWN',
] as const;

export type QueueRangeLabel = (typeof QUEUE_RANGE_LABELS)[number];

/**
 * Converts a submitted label into its internal bucket and numeric range.
 *
 * "UNKNOWN" maps to null bounds — the whole point is that a user who does not
 * know the queue length must not be recorded as having seen an empty forecourt.
 * En-dashes are accepted because they are easy to introduce by copy-paste.
 */
export function parseQueueRangeLabel(
  label: string,
): { bucket: QueueBucket; range: QueueRange } {
  const normalized = label.trim().toUpperCase().replace(/[–—]/g, '-');

  if (normalized === 'UNKNOWN') {
    return { bucket: QueueBucket.UNKNOWN, range: UNKNOWN_QUEUE };
  }

  const match = QUEUE_BUCKETS.find(
    (b) => b.label.toUpperCase() === normalized && b.bucket !== QueueBucket.UNKNOWN,
  );

  if (!match) {
    return { bucket: QueueBucket.UNKNOWN, range: UNKNOWN_QUEUE };
  }

  return { bucket: match.bucket, range: { min: match.min, max: match.max } };
}

/**
 * The numeric bounds to STORE for a submitted bucket.
 *
 * The open-ended "25+" bucket has no upper bound, so its stored max is the
 * lower bound — recording a real observation conservatively rather than
 * inventing a ceiling. UNKNOWN stores null/null.
 */
export function storableRangeForLabel(label: string): {
  bucket: QueueBucket;
  min: number | null;
  max: number | null;
} {
  const { bucket, range } = parseQueueRangeLabel(label);

  if (range.min === null && range.max === null) {
    return { bucket, min: null, max: null };
  }

  return {
    bucket,
    min: range.min,
    max: range.max ?? range.min,
  };
}
