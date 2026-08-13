import {
  Availability,
  Freshness,
  type NotificationRule,
  type StationStatus,
} from '@prisma/client';
import { NOTIFICATIONS } from '../config/constants';
import { toBar } from '../utils/pressure';

/**
 * Rule evaluation with CONSERVATIVE threshold semantics.
 *
 * Queue and wait are ranges, not points. A condition is satisfied only when the
 * range GUARANTEES it — the worst case must pass, not the best.
 *
 * The motivating example: a user wants "queue <= 5" and the station reads 4-7.
 * That does NOT trigger. The queue might be 7, and sending someone across town
 * on a maybe is worse than staying quiet. Silence costs a missed opportunity;
 * a false alarm costs trust.
 *
 * The same reasoning makes UNKNOWN never satisfy a threshold: no information is
 * not evidence of a short queue.
 *
 * Selected conditions combine with AND — every one specified must hold.
 */

export type ConditionKey =
  | 'availability'
  | 'maxQueue'
  | 'maxWait'
  | 'minPressure'
  | 'freshness'
  | 'confidence';

export interface ConditionResult {
  key: ConditionKey;
  /** Undefined when the rule did not specify this condition. */
  specified: boolean;
  passed: boolean;
  reason: string;
}

export interface EvaluationResult {
  /** True only when every specified condition is guaranteed satisfied. */
  met: boolean;
  conditions: ConditionResult[];
  /** Compact snapshot of the values the decision was made on. */
  snapshot: Record<string, unknown>;
}

const pass = (key: ConditionKey, reason: string): ConditionResult => ({
  key,
  specified: true,
  passed: true,
  reason,
});

const fail = (key: ConditionKey, reason: string): ConditionResult => ({
  key,
  specified: true,
  passed: false,
  reason,
});

const skip = (key: ConditionKey): ConditionResult => ({
  key,
  specified: false,
  passed: true,
  reason: 'not specified',
});

/**
 * Availability must be one of the required values. An empty list means the user
 * did not constrain availability. UNKNOWN never satisfies a requirement.
 */
function evaluateAvailability(
  rule: NotificationRule,
  status: StationStatus,
): ConditionResult {
  if (rule.requiredAvailability.length === 0) return skip('availability');

  if (status.availability === Availability.UNKNOWN) {
    return fail('availability', 'availability is UNKNOWN');
  }

  return rule.requiredAvailability.includes(status.availability)
    ? pass('availability', `availability is ${status.availability}`)
    : fail('availability', `availability is ${status.availability}`);
}

/**
 * Conservative upper-bound check.
 *
 * Compares the range's MAXIMUM against the threshold, so the condition holds
 * only if every value the range admits satisfies it.
 */
function evaluateUpperBound(
  key: ConditionKey,
  threshold: number | null,
  rangeMin: number | null,
  rangeMax: number | null,
  label: string,
): ConditionResult {
  if (threshold === null) return skip(key);

  // Unknown is not "small". Refuse rather than guess.
  if (rangeMin === null && rangeMax === null) {
    return fail(key, `${label} is unknown`);
  }

  // Worst case within the range. A missing max with a known min means the
  // range is open-ended upward, which can never be guaranteed under a cap.
  const worstCase = rangeMax ?? null;
  if (worstCase === null) {
    return fail(key, `${label} has no upper bound`);
  }

  return worstCase <= threshold
    ? pass(key, `${label} at most ${worstCase} <= ${threshold}`)
    : fail(key, `${label} could be ${worstCase}, which exceeds ${threshold}`);
}

/**
 * Conservative lower-bound check for pressure.
 *
 * Pressure is a single averaged value rather than a range, but the same rule
 * applies: an unknown reading never satisfies a minimum.
 */
function evaluateMinPressure(
  rule: NotificationRule,
  status: StationStatus,
): ConditionResult {
  if (rule.minPressure === null) return skip('minPressure');

  if (status.pressureValue === null) {
    return fail('minPressure', 'pressure is unknown');
  }

  // The rule's threshold carries its own unit; both sides are normalised to bar
  // so a rule written in psi compares correctly against a bar reading.
  const thresholdBar = toBar(rule.minPressure, rule.pressureUnit);
  const actualBar = toBar(status.pressureValue, status.pressureUnit);

  return actualBar >= thresholdBar
    ? pass('minPressure', `pressure ${actualBar} >= ${thresholdBar} bar`)
    : fail('minPressure', `pressure ${actualBar} < ${thresholdBar} bar`);
}

/**
 * Data-quality gates applied to every rule.
 *
 * These are not user-configurable conditions: they stop the engine waking
 * someone based on information the platform itself does not trust.
 */
function evaluateDataQuality(status: StationStatus): ConditionResult[] {
  const freshEnough = (NOTIFICATIONS.minFreshnessToNotify as readonly string[]).includes(
    status.freshness,
  );

  return [
    {
      key: 'freshness',
      specified: true,
      passed: freshEnough,
      reason: freshEnough
        ? `status is ${status.freshness}`
        : `status is ${status.freshness}, too stale to notify`,
    },
    {
      key: 'confidence',
      specified: true,
      passed: status.confidence >= NOTIFICATIONS.minConfidenceToNotify,
      reason: `confidence ${status.confidence} vs minimum ${NOTIFICATIONS.minConfidenceToNotify}`,
    },
  ];
}

export const ruleEvaluator = {
  /**
   * Evaluates a rule against a station status.
   *
   * Pure and deterministic — no clock, no database. Cooldown and transition
   * handling live in the notification service; this answers only "do the
   * conditions hold right now?".
   */
  evaluate(rule: NotificationRule, status: StationStatus | null): EvaluationResult {
    if (!status) {
      return {
        met: false,
        conditions: [
          { key: 'availability', specified: true, passed: false, reason: 'no status' },
        ],
        snapshot: { status: null },
      };
    }

    const conditions: ConditionResult[] = [
      evaluateAvailability(rule, status),
      evaluateUpperBound('maxQueue', rule.maxQueue, status.queueMin, status.queueMax, 'queue'),
      evaluateUpperBound(
        'maxWait',
        rule.maxWaitMinutes,
        status.waitMin,
        status.waitMax,
        'wait',
      ),
      evaluateMinPressure(rule, status),
      ...evaluateDataQuality(status),
    ];

    // AND across every condition. A skipped condition passes vacuously.
    const met = conditions.every((condition) => condition.passed);

    return {
      met,
      conditions,
      snapshot: {
        availability: status.availability,
        queueMin: status.queueMin,
        queueMax: status.queueMax,
        waitMin: status.waitMin,
        waitMax: status.waitMax,
        pressureValue: status.pressureValue,
        pressureUnit: status.pressureUnit,
        confidence: status.confidence,
        freshness: status.freshness,
        computedAt: status.computedAt,
        failedConditions: conditions
          .filter((c) => c.specified && !c.passed)
          .map((c) => `${c.key}: ${c.reason}`),
      },
    };
  },

  /** Whether a status is fresh enough to be worth notifying about at all. */
  isNotifiable(status: StationStatus | null): boolean {
    if (!status) return false;
    if (status.freshness === Freshness.UNKNOWN) return false;
    return (NOTIFICATIONS.minFreshnessToNotify as readonly string[]).includes(
      status.freshness,
    );
  },
};
