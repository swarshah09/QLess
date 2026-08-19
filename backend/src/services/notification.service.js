'use strict';

const { createHash } = require('node:crypto');
const NotificationRule = require('../models/NotificationRule');
const NotificationEvent = require('../models/NotificationEvent');
const PushSubscription = require('../models/PushSubscription');
const Station = require('../models/Station');
const logger = require('../config/logger');
const { NOTIFICATIONS } = require('../config/constants');
const { ApiError } = require('../utils/ApiError');
const ruleEvaluator = require('../notifications/ruleEvaluator');
const { composeMessage } = require('../notifications/messageComposer');
const { getTransport } = require('../notifications/webPush');

/**
 * Notification engine.
 *
 * A rule fires only on the EDGE into MET:
 *   FALSE → TRUE   send (subject to cooldown)
 *   TRUE  → TRUE   no send (conditions merely still hold)
 *   TRUE  → FALSE  no send (record the state change only)
 *   FALSE → TRUE   send again, once cooldown allows
 *
 * A rule in cooldown still transitions to MET but sends nothing, so it does not
 * re-fire the instant cooldown lapses while conditions have held throughout.
 */

/**
 * Deterministic idempotency key from the rule and the exact transition that
 * fired it — `computedAt` identifies that recomputation uniquely. Re-processing
 * the same status change produces the same key, and the unique index turns the
 * second attempt into a no-op.
 */
function dedupeKeyFor(rule, status) {
  const material = [
    String(rule._id),
    String(rule.station),
    new Date(status.computedAt).toISOString(),
    rule.channel,
  ].join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 64);
}

const notificationService = {
  /**
   * Evaluates active rules for ONE station after its status changed.
   *
   * Scoped to the affected station by design: a status change cannot alter the
   * outcome of a rule watching somewhere else, so there is never a global scan.
   */
  async evaluateStation(stationId, options = {}) {
    const now = options.now ?? new Date();
    const summary = {
      stationId: String(stationId),
      rulesEvaluated: 0,
      transitionsToMet: 0,
      eventsCreated: 0,
      suppressedByCooldown: 0,
    };

    const rules = await NotificationRule.find({ station: stationId, enabled: true });
    if (rules.length === 0) return summary;

    const station = options.station ?? (await Station.findById(stationId));
    if (!station) return summary;

    const status = station.status;

    for (const rule of rules) {
      summary.rulesEvaluated += 1;

      const result = ruleEvaluator.evaluate(rule, status);
      const previous = rule.conditionState;
      const next = result.met ? 'MET' : 'UNMET';

      // No edge — the TRUE→TRUE and FALSE→FALSE cases.
      if (previous === next) {
        rule.lastEvaluatedAt = now;
        await rule.save();
        continue;
      }

      // Falling out of MET is a state change with no notification.
      if (!result.met) {
        await NotificationRule.updateOne(
          { _id: rule._id, conditionState: previous },
          { conditionState: 'UNMET', lastEvaluatedAt: now },
        );
        continue;
      }

      // --- Edge into MET ---
      summary.transitionsToMet += 1;

      if (rule.cooldownUntil && rule.cooldownUntil > now) {
        // State still advances, so when cooldown expires the rule is already
        // MET and will not spuriously re-fire without a fresh edge.
        await NotificationRule.updateOne(
          { _id: rule._id, conditionState: previous },
          { conditionState: 'MET', lastEvaluatedAt: now },
        );
        summary.suppressedByCooldown += 1;
        continue;
      }

      const cooldownMinutes = rule.cooldownMinutes || NOTIFICATIONS.defaultCooldownMinutes;

      /**
       * Compare-and-set. If a concurrent evaluation already moved this rule to
       * MET, this matches nothing and we skip — only one evaluation may claim a
       * given transition, so only one notification is produced.
       */
      const claimed = await NotificationRule.findOneAndUpdate(
        { _id: rule._id, conditionState: previous },
        {
          conditionState: 'MET',
          lastEvaluatedAt: now,
          lastTriggeredAt: now,
          cooldownUntil: new Date(now.getTime() + cooldownMinutes * 60000),
        },
      );
      if (!claimed) continue;

      const message = composeMessage(station, status);

      let event;
      try {
        event = await NotificationEvent.create({
          dedupeKey: dedupeKeyFor(rule, status),
          user: rule.user,
          rule: rule._id,
          station: stationId,
          channel: rule.channel,
          title: message.title,
          body: message.body,
          payload: message.payload,
          triggerSnapshot: result.snapshot,
        });
      } catch (error) {
        // Duplicate key: an event for this exact transition already exists.
        if (error?.code === 11000) continue;
        throw error;
      }

      summary.eventsCreated += 1;

      // Delivery must never fail the status recomputation that triggered it.
      this.deliver(event).catch((error) => {
        logger.error('Notification delivery failed', {
          eventId: String(event._id),
          error: error.message,
        });
      });
    }

    return summary;
  },

  /**
   * Delivers one event to every active device the user has.
   *
   * Marked SENT if ANY device accepted it — the user has been reached, and one
   * dead tablet should not fail the whole notification.
   */
  async deliver(eventOrId) {
    const event =
      typeof eventOrId === 'string' ? await NotificationEvent.findById(eventOrId) : eventOrId;
    if (!event) return;

    const transport = getTransport();

    if (!transport.configured) {
      event.status = 'SUPPRESSED';
      event.error = 'Web Push is not configured (missing VAPID keys)';
      await event.save();
      return;
    }

    const subscriptions = await PushSubscription.find({ user: event.user, active: true });

    if (subscriptions.length === 0) {
      event.status = 'SUPPRESSED';
      event.error = 'No active push subscriptions';
      await event.save();
      return;
    }

    let delivered = false;
    const errors = [];

    for (const subscription of subscriptions) {
      const outcome = await transport.send(
        {
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
        { title: event.title, body: event.body, data: event.payload },
      );

      if (outcome.ok) {
        delivered = true;
        subscription.lastUsedAt = new Date();
        await subscription.save();
        continue;
      }

      errors.push(`${subscription.endpoint.slice(-24)}: ${outcome.error}`);

      // A gone subscription is retired so it stops being tried forever.
      if (!outcome.retryable && outcome.gone) {
        subscription.active = false;
        await subscription.save();
        logger.info('Deactivated expired push subscription', {
          subscriptionId: String(subscription._id),
        });
      }
    }

    event.attempts += 1;
    if (delivered) {
      event.status = 'SENT';
      event.sentAt = new Date();
    } else {
      event.status = 'FAILED';
      event.error = errors.join('; ').slice(0, 1000) || 'Delivery failed';
    }
    await event.save();
  },

  // --- Rule CRUD ------------------------------------------------------------

  async listRules(userId) {
    const rules = await NotificationRule.find({ user: userId })
      .populate('station', 'name address city')
      .sort({ createdAt: -1 })
      .lean();

    return rules.map((rule) => this.serializeRule(rule));
  },

  serializeRule(rule) {
    const station = rule.station && typeof rule.station === 'object' ? rule.station : null;
    return {
      id: String(rule._id),
      stationId: String(station?._id ?? rule.station),
      requiredAvailability: rule.requiredAvailability ?? [],
      maxQueue: rule.maxQueue ?? null,
      maxWaitMinutes: rule.maxWaitMinutes ?? null,
      minPressure: rule.minPressure ?? null,
      pressureUnit: rule.pressureUnit ?? 'BAR',
      enabled: rule.enabled,
      currentConditionState: rule.conditionState,
      lastTriggeredAt: rule.lastTriggeredAt ?? null,
      cooldownMinutes: rule.cooldownMinutes,
      createdAt: rule.createdAt,
      station: station ? { id: String(station._id), name: station.name } : null,
    };
  },

  async createRule(userId, input) {
    const hasCondition =
      (input.requiredAvailability?.length ?? 0) > 0 ||
      input.maxQueue != null ||
      input.maxWaitMinutes != null ||
      input.minPressure != null;

    // A rule with no conditions would fire on every status change.
    if (!hasCondition) {
      throw ApiError.badRequest(
        'A rule must specify at least one condition (availability, queue, wait or pressure)',
      );
    }

    if (!(await Station.exists({ _id: input.stationId }))) {
      throw ApiError.notFound('Station not found');
    }

    const count = await NotificationRule.countDocuments({ user: userId });
    if (count >= NOTIFICATIONS.maxRulesPerUser) {
      throw ApiError.badRequest(
        `You can have at most ${NOTIFICATIONS.maxRulesPerUser} notification rules`,
      );
    }

    try {
      const rule = await NotificationRule.create({
        user: userId,
        station: input.stationId,
        requiredAvailability: input.requiredAvailability ?? [],
        maxQueue: input.maxQueue ?? null,
        maxWaitMinutes: input.maxWaitMinutes ?? null,
        minPressure: input.minPressure ?? null,
        pressureUnit: input.pressureUnit ?? 'BAR',
        enabled: input.enabled ?? true,
        cooldownMinutes: input.cooldownMinutes ?? NOTIFICATIONS.defaultCooldownMinutes,
      });
      return this.serializeRule(rule.toObject());
    } catch (error) {
      if (error?.code === 11000) {
        throw ApiError.conflict('You already have an alert for this station');
      }
      throw error;
    }
  },

  async findOwnedRule(ruleId, userId) {
    const rule = await NotificationRule.findById(ruleId);
    // Someone else's rule reads as missing, so rule ids cannot be probed.
    if (!rule || String(rule.user) !== String(userId)) {
      throw ApiError.notFound('Notification rule not found');
    }
    return rule;
  },

  async updateRule(ruleId, userId, input) {
    const rule = await this.findOwnedRule(ruleId, userId);

    const merged = {
      requiredAvailability: input.requiredAvailability ?? rule.requiredAvailability,
      maxQueue: input.maxQueue !== undefined ? input.maxQueue : rule.maxQueue,
      maxWaitMinutes:
        input.maxWaitMinutes !== undefined ? input.maxWaitMinutes : rule.maxWaitMinutes,
      minPressure: input.minPressure !== undefined ? input.minPressure : rule.minPressure,
    };

    const hasCondition =
      (merged.requiredAvailability?.length ?? 0) > 0 ||
      merged.maxQueue != null ||
      merged.maxWaitMinutes != null ||
      merged.minPressure != null;

    if (!hasCondition) throw ApiError.badRequest('A rule must specify at least one condition');

    for (const key of [
      'requiredAvailability',
      'maxQueue',
      'maxWaitMinutes',
      'minPressure',
      'pressureUnit',
      'cooldownMinutes',
      'enabled',
    ]) {
      if (input[key] !== undefined) rule[key] = input[key];
    }

    /**
     * Changing what a rule watches resets its transition state. Without this, a
     * rule sitting at MET under the old thresholds would look already-satisfied
     * under the new ones and never produce the edge the user now expects.
     */
    const conditionsChanged = [
      'requiredAvailability',
      'maxQueue',
      'maxWaitMinutes',
      'minPressure',
    ].some((key) => input[key] !== undefined);

    if (conditionsChanged) {
      rule.conditionState = 'UNKNOWN';
      rule.cooldownUntil = null;
    }

    await rule.save();
    return this.serializeRule(rule.toObject());
  },

  async deleteRule(ruleId, userId) {
    await this.findOwnedRule(ruleId, userId);
    await NotificationRule.deleteOne({ _id: ruleId });
  },

  // --- Push subscriptions ---------------------------------------------------

  async listSubscriptions(userId) {
    const subscriptions = await PushSubscription.find({ user: userId, active: true }).lean();
    // Endpoints are capability URLs — anyone holding one can push to the device
    // — so only a short suffix is returned.
    return subscriptions.map((s) => ({
      id: String(s._id),
      endpointSuffix: s.endpoint.slice(-16),
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
    }));
  },

  async subscribe(userId, { endpoint, p256dh, auth, userAgent }) {
    const existing = await PushSubscription.findOne({ endpoint });

    if (!existing || String(existing.user) !== String(userId)) {
      const count = await PushSubscription.countDocuments({ user: userId, active: true });
      if (count >= NOTIFICATIONS.maxSubscriptionsPerUser) {
        throw ApiError.badRequest(
          `You can register at most ${NOTIFICATIONS.maxSubscriptionsPerUser} devices`,
        );
      }
    }

    // Upsert on endpoint: a browser re-sending its subscription refreshes it,
    // and reclaims one that was previously deactivated.
    const subscription = await PushSubscription.findOneAndUpdate(
      { endpoint },
      { user: userId, endpoint, p256dh, auth, userAgent: userAgent ?? null, active: true },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return { id: String(subscription._id), active: subscription.active };
  },

  async unsubscribe(userId, endpoint) {
    const result = await PushSubscription.deleteOne({ user: userId, endpoint });
    if (result.deletedCount === 0) throw ApiError.notFound('Subscription not found');
  },

  async listEvents(userId, { page = 1, limit = 25 }) {
    const [items, total] = await Promise.all([
      NotificationEvent.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      NotificationEvent.countDocuments({ user: userId }),
    ]);

    return {
      items: items.map((e) => ({
        id: String(e._id),
        title: e.title,
        body: e.body,
        status: e.status,
        payload: e.payload,
        createdAt: e.createdAt,
        sentAt: e.sentAt,
      })),
      total,
    };
  },
};

module.exports = notificationService;
module.exports.dedupeKeyFor = dedupeKeyFor;
