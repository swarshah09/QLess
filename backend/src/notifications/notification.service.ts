import { createHash } from 'node:crypto';
import {
  NotificationChannel,
  type Prisma,
  type NotificationEvent,
  type NotificationRule,
  RuleConditionState,
  type StationStatus,
} from '@prisma/client';
import { NOTIFICATIONS } from '../config/constants';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import {
  notificationEventRepository,
  notificationRuleRepository,
  pushSubscriptionRepository,
} from '../repositories/notification.repository';
import { stationStatusRepository } from '../repositories/stationStatus.repository';
import { composeMessage } from './messageComposer';
import { createInlineDispatcher, type NotificationDispatcher } from './dispatcher';
import { ruleEvaluator } from './ruleEvaluator';
import { webPushTransport, type PushTransport } from './webPush.transport';

/**
 * Notification engine.
 *
 * Transition semantics — a rule fires only on the EDGE into MET:
 *   FALSE → TRUE   send (subject to cooldown)
 *   TRUE  → TRUE   no send (conditions merely still hold)
 *   TRUE  → FALSE  no send (record the state change only)
 *   FALSE → TRUE   send again, once cooldown allows
 *
 * A rule still in cooldown transitions to MET but sends nothing, so it does not
 * re-fire the instant the cooldown lapses while conditions have held throughout.
 */

export interface EvaluationSummary {
  stationId: string;
  rulesEvaluated: number;
  transitionsToMet: number;
  eventsCreated: number;
  suppressedByCooldown: number;
}

/**
 * Deterministic idempotency key.
 *
 * Derived from the rule and the exact transition that fired it — the status's
 * `computedAt` identifies that recomputation uniquely. Re-processing the same
 * status change therefore produces the same key, and the unique index turns the
 * second attempt into a no-op.
 */
export function dedupeKeyFor(rule: NotificationRule, status: StationStatus): string {
  const material = [
    rule.id,
    rule.stationId,
    status.computedAt.toISOString(),
    rule.channel,
  ].join('|');

  return createHash('sha256').update(material).digest('hex').slice(0, 64);
}

let transport: PushTransport = webPushTransport;
let dispatcher: NotificationDispatcher;

/** Test seam — lets a suite record deliveries instead of hitting the network. */
export function setPushTransport(next: PushTransport): void {
  transport = next;
}

export const notificationService = {
  /**
   * Evaluates every active rule for ONE station after its status changed.
   *
   * Scoped to the affected station by design: a status change cannot alter the
   * outcome of a rule watching somewhere else, so there is never a global scan.
   */
  async evaluateStation(
    stationId: string,
    options: { now?: Date; status?: StationStatus | null } = {},
  ): Promise<EvaluationSummary> {
    const now = options.now ?? new Date();

    const summary: EvaluationSummary = {
      stationId,
      rulesEvaluated: 0,
      transitionsToMet: 0,
      eventsCreated: 0,
      suppressedByCooldown: 0,
    };

    const rules = await notificationRuleRepository.listActiveForStation(stationId);
    if (rules.length === 0) return summary;

    const status =
      options.status !== undefined
        ? options.status
        : await stationStatusRepository.findByStationId(stationId);

    const station = await prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true, name: true },
    });
    if (!station) return summary;

    for (const rule of rules) {
      summary.rulesEvaluated += 1;

      const result = ruleEvaluator.evaluate(rule, status);
      const previousState = rule.currentConditionState;
      const nextState = result.met ? RuleConditionState.MET : RuleConditionState.UNMET;

      // No edge: record that we looked, and move on. This is the TRUE→TRUE and
      // FALSE→FALSE case.
      if (previousState === nextState) {
        await notificationRuleRepository.touchEvaluated(rule.id, now);
        continue;
      }

      // Falling out of MET is a state change with no notification.
      if (!result.met) {
        await notificationRuleRepository.transitionState({
          id: rule.id,
          expectedState: previousState,
          nextState: RuleConditionState.UNMET,
          evaluatedAt: now,
        });
        continue;
      }

      // --- Edge into MET ---
      summary.transitionsToMet += 1;

      const inCooldown = rule.cooldownUntil !== null && rule.cooldownUntil > now;

      if (inCooldown) {
        // The state still advances, so when cooldown expires the rule is
        // already MET and will not spuriously re-fire without a fresh edge.
        await notificationRuleRepository.transitionState({
          id: rule.id,
          expectedState: previousState,
          nextState: RuleConditionState.MET,
          evaluatedAt: now,
        });
        summary.suppressedByCooldown += 1;
        continue;
      }

      const cooldownMinutes = rule.cooldownMinutes || NOTIFICATIONS.defaultCooldownMinutes;

      // Compare-and-set. If a concurrent evaluation already moved this rule to
      // MET, this matches nothing and we skip — only one evaluation may claim
      // a given transition, so only one notification is produced.
      const claimed = await notificationRuleRepository.transitionState({
        id: rule.id,
        expectedState: previousState,
        nextState: RuleConditionState.MET,
        evaluatedAt: now,
        triggeredAt: now,
        cooldownUntil: new Date(now.getTime() + cooldownMinutes * 60_000),
      });

      if (!claimed) continue;

      const message = composeMessage(station, status!);

      const event = await notificationEventRepository.createIfAbsent({
        dedupeKey: dedupeKeyFor(rule, status!),
        userId: rule.userId,
        ruleId: rule.id,
        stationId,
        channel: rule.channel,
        title: message.title,
        body: message.body,
        payload: message.payload as unknown as Prisma.InputJsonObject,
        triggerSnapshot: result.snapshot as Prisma.InputJsonObject,
      });

      // Null means an event for this exact transition already existed —
      // duplicate processing, correctly ignored.
      if (!event) continue;

      summary.eventsCreated += 1;
      await dispatcher.dispatch(event);
    }

    return summary;
  },

  /**
   * Delivers one event to every active device the user has.
   *
   * The event is marked SENT if ANY device accepted it: the user has been
   * reached, and one dead tablet should not mark the whole notification failed.
   */
  async deliver(event: NotificationEvent): Promise<void> {
    if (event.channel !== NotificationChannel.WEB_PUSH) {
      await notificationEventRepository.markSuppressed(
        event.id,
        `Channel ${event.channel} is not implemented`,
      );
      return;
    }

    if (!transport.configured) {
      await notificationEventRepository.markSuppressed(
        event.id,
        'Web Push is not configured (missing VAPID keys)',
      );
      return;
    }

    const subscriptions = await pushSubscriptionRepository.listActiveForUser(event.userId);

    if (subscriptions.length === 0) {
      await notificationEventRepository.markSuppressed(event.id, 'No active push subscriptions');
      return;
    }

    let delivered = false;
    let deliveredVia: string | null = null;
    const errors: string[] = [];

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
        deliveredVia ??= subscription.id;
        await pushSubscriptionRepository.markUsed(subscription.id);
        continue;
      }

      errors.push(`${subscription.endpoint.slice(-24)}: ${outcome.error}`);

      // A gone subscription is retired so it stops being tried on every future
      // notification.
      if (!outcome.retryable && outcome.gone) {
        await pushSubscriptionRepository.deactivate(subscription.id, 'Subscription expired');
        logger.info({ subscriptionId: subscription.id }, 'Deactivated expired push subscription');
      }
    }

    if (delivered) {
      await notificationEventRepository.markSent(event.id, deliveredVia);
    } else {
      await notificationEventRepository.markFailed(
        event.id,
        errors.join('; ') || 'Delivery failed',
      );
    }
  },

  /** Drains pending events. Entry point for a future queue worker. */
  async processPending(limit = 50): Promise<number> {
    const pending = await notificationEventRepository.listPending(limit);

    for (const event of pending) {
      if (event.attempts >= NOTIFICATIONS.maxDeliveryAttempts) {
        await notificationEventRepository.markFailed(event.id, 'Maximum attempts exceeded');
        continue;
      }
      await this.deliver(event);
    }

    return pending.length;
  },
};

// Wired after the service so the inline dispatcher can call back into it.
dispatcher = createInlineDispatcher((event) => notificationService.deliver(event));

/** Test seam for swapping the dispatcher. */
export function setDispatcher(next: NotificationDispatcher): void {
  dispatcher = next;
}
