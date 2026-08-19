'use strict';

const { NOTIFICATIONS } = require('../config/constants');
const { toBar } = require('../utils/domain');

/**
 * Rule evaluation with CONSERVATIVE threshold semantics.
 *
 * Queue and wait are RANGES, not points. A condition is satisfied only when the
 * range GUARANTEES it — the worst case must pass, not the best.
 *
 * The motivating case: a user wants "queue <= 5" and the station reads 4-7.
 * That does NOT trigger, because the queue might be 7. Sending someone across
 * town on a maybe is worse than staying quiet: silence costs a missed
 * opportunity, a false alarm costs trust.
 *
 * The same reasoning makes UNKNOWN never satisfy a threshold — no information
 * is not evidence of a short queue.
 *
 * Selected conditions combine with AND.
 */

const pass = (key, reason) => ({ key, specified: true, passed: true, reason });
const fail = (key, reason) => ({ key, specified: true, passed: false, reason });
const skip = (key) => ({ key, specified: false, passed: true, reason: 'not specified' });

/** Conservative upper-bound check against the range's MAXIMUM. */
function evaluateUpperBound(key, threshold, rangeMin, rangeMax, label) {
  if (threshold === null || threshold === undefined) return skip(key);

  // Unknown is not "small". Refuse rather than guess.
  if (rangeMin === null && rangeMax === null) return fail(key, `${label} is unknown`);

  const worstCase = rangeMax ?? null;
  // An open-ended range can never be guaranteed under a cap.
  if (worstCase === null) return fail(key, `${label} has no upper bound`);

  return worstCase <= threshold
    ? pass(key, `${label} at most ${worstCase} <= ${threshold}`)
    : fail(key, `${label} could be ${worstCase}, which exceeds ${threshold}`);
}

const ruleEvaluator = {
  evaluate(rule, status) {
    if (!status) {
      return {
        met: false,
        conditions: [fail('availability', 'no status')],
        snapshot: { status: null },
      };
    }

    const conditions = [];

    // --- Availability ---
    if (!rule.requiredAvailability?.length) {
      conditions.push(skip('availability'));
    } else if (status.availability === 'UNKNOWN') {
      conditions.push(fail('availability', 'availability is UNKNOWN'));
    } else {
      conditions.push(
        rule.requiredAvailability.includes(status.availability)
          ? pass('availability', `availability is ${status.availability}`)
          : fail('availability', `availability is ${status.availability}`),
      );
    }

    conditions.push(
      evaluateUpperBound('maxQueue', rule.maxQueue, status.queueMin, status.queueMax, 'queue'),
    );
    conditions.push(
      evaluateUpperBound('maxWait', rule.maxWaitMinutes, status.waitMin, status.waitMax, 'wait'),
    );

    // --- Pressure ---
    if (rule.minPressure === null || rule.minPressure === undefined) {
      conditions.push(skip('minPressure'));
    } else if (status.pressureValue === null || status.pressureValue === undefined) {
      conditions.push(fail('minPressure', 'pressure is unknown'));
    } else {
      // Both sides normalised to bar, so a rule written in psi compares
      // correctly against a bar reading.
      const thresholdBar = toBar(rule.minPressure, rule.pressureUnit ?? 'BAR');
      const actualBar = toBar(status.pressureValue, status.pressureUnit ?? 'BAR');
      conditions.push(
        actualBar >= thresholdBar
          ? pass('minPressure', `pressure ${actualBar} >= ${thresholdBar} bar`)
          : fail('minPressure', `pressure ${actualBar} < ${thresholdBar} bar`),
      );
    }

    /**
     * Data-quality gates applied to EVERY rule. Not user-configurable: they
     * stop the engine waking someone on information the platform itself does
     * not trust.
     */
    const freshEnough = NOTIFICATIONS.minFreshnessToNotify.includes(status.freshness);
    conditions.push({
      key: 'freshness',
      specified: true,
      passed: freshEnough,
      reason: freshEnough
        ? `status is ${status.freshness}`
        : `status is ${status.freshness}, too stale to notify`,
    });
    conditions.push({
      key: 'confidence',
      specified: true,
      passed: status.confidence >= NOTIFICATIONS.minConfidenceToNotify,
      reason: `confidence ${status.confidence} vs minimum ${NOTIFICATIONS.minConfidenceToNotify}`,
    });

    // AND across every condition; a skipped one passes vacuously.
    const met = conditions.every((c) => c.passed);

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
        confidence: status.confidence,
        freshness: status.freshness,
        computedAt: status.computedAt,
        failedConditions: conditions
          .filter((c) => c.specified && !c.passed)
          .map((c) => `${c.key}: ${c.reason}`),
      },
    };
  },
};

module.exports = ruleEvaluator;
