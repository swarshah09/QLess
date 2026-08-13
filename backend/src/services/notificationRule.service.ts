import {
  type Availability,
  NotificationChannel,
  type NotificationRule,
  type PressureUnit,
  RuleConditionState,
} from '@prisma/client';
import { NOTIFICATIONS } from '../config/constants';
import { AppError } from '../errors/AppError';
import {
  notificationEventRepository,
  notificationRuleRepository,
  pushSubscriptionRepository,
} from '../repositories/notification.repository';
import { stationRepository } from '../repositories/station.repository';

export interface CreateRuleInput {
  stationId: string;
  requiredAvailability?: Availability[];
  maxQueue?: number | null;
  maxWaitMinutes?: number | null;
  minPressure?: number | null;
  pressureUnit?: PressureUnit;
  enabled?: boolean;
  cooldownMinutes?: number;
}

export type UpdateRuleInput = Partial<Omit<CreateRuleInput, 'stationId'>>;

/** A rule with no conditions would fire on every status change. */
function assertHasCondition(input: {
  requiredAvailability?: Availability[];
  maxQueue?: number | null;
  maxWaitMinutes?: number | null;
  minPressure?: number | null;
}): void {
  const hasCondition =
    (input.requiredAvailability?.length ?? 0) > 0 ||
    input.maxQueue !== null ||
    input.maxWaitMinutes !== null ||
    input.minPressure !== null;

  if (!hasCondition) {
    throw AppError.badRequest(
      'A rule must specify at least one condition (availability, queue, wait or pressure)',
    );
  }
}

export const notificationRuleService = {
  async list(userId: string) {
    return notificationRuleRepository.listForUser(userId);
  },

  async create(userId: string, input: CreateRuleInput): Promise<NotificationRule> {
    assertHasCondition({
      requiredAvailability: input.requiredAvailability,
      maxQueue: input.maxQueue ?? null,
      maxWaitMinutes: input.maxWaitMinutes ?? null,
      minPressure: input.minPressure ?? null,
    });

    const station = await stationRepository.exists(input.stationId);
    if (!station) throw AppError.notFound('Station not found');

    const existingCount = await notificationRuleRepository.countForUser(userId);
    if (existingCount >= NOTIFICATIONS.maxRulesPerUser) {
      throw AppError.badRequest(
        `You can have at most ${NOTIFICATIONS.maxRulesPerUser} notification rules`,
      );
    }

    try {
      return await notificationRuleRepository.create({
        userId,
        stationId: input.stationId,
        requiredAvailability: input.requiredAvailability ?? [],
        maxQueue: input.maxQueue ?? null,
        maxWaitMinutes: input.maxWaitMinutes ?? null,
        minPressure: input.minPressure ?? null,
        pressureUnit: input.pressureUnit,
        channel: NotificationChannel.WEB_PUSH,
        enabled: input.enabled ?? true,
        cooldownMinutes: input.cooldownMinutes ?? NOTIFICATIONS.defaultCooldownMinutes,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw AppError.conflict('You already have an alert for this station');
      }
      throw error;
    }
  },

  /** Loads a rule and confirms it belongs to the caller. */
  async findOwned(id: string, userId: string): Promise<NotificationRule> {
    const rule = await notificationRuleRepository.findById(id);

    // A rule owned by someone else is reported as missing rather than
    // forbidden, so rule ids cannot be probed.
    if (!rule || rule.userId !== userId) {
      throw AppError.notFound('Notification rule not found');
    }

    return rule;
  },

  async update(
    id: string,
    userId: string,
    input: UpdateRuleInput,
  ): Promise<NotificationRule> {
    const rule = await this.findOwned(id, userId);

    const merged = {
      requiredAvailability: input.requiredAvailability ?? rule.requiredAvailability,
      maxQueue: input.maxQueue !== undefined ? input.maxQueue : rule.maxQueue,
      maxWaitMinutes:
        input.maxWaitMinutes !== undefined ? input.maxWaitMinutes : rule.maxWaitMinutes,
      minPressure: input.minPressure !== undefined ? input.minPressure : rule.minPressure,
    };

    assertHasCondition(merged);

    /**
     * Changing what a rule watches resets its transition state.
     *
     * Without this, a rule sitting at MET under the old thresholds would be
     * seen as already-satisfied under the new ones and would never produce the
     * FALSE→TRUE edge the user is now waiting for.
     */
    const conditionsChanged =
      input.requiredAvailability !== undefined ||
      input.maxQueue !== undefined ||
      input.maxWaitMinutes !== undefined ||
      input.minPressure !== undefined;

    return notificationRuleRepository.update(id, {
      ...(input.requiredAvailability !== undefined && {
        requiredAvailability: input.requiredAvailability,
      }),
      ...(input.maxQueue !== undefined && { maxQueue: input.maxQueue }),
      ...(input.maxWaitMinutes !== undefined && { maxWaitMinutes: input.maxWaitMinutes }),
      ...(input.minPressure !== undefined && { minPressure: input.minPressure }),
      ...(input.pressureUnit !== undefined && { pressureUnit: input.pressureUnit }),
      ...(input.cooldownMinutes !== undefined && { cooldownMinutes: input.cooldownMinutes }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(conditionsChanged && {
        currentConditionState: RuleConditionState.UNKNOWN,
        cooldownUntil: null,
      }),
    });
  },

  async remove(id: string, userId: string): Promise<void> {
    await this.findOwned(id, userId);
    await notificationRuleRepository.delete(id);
  },
};

export const pushSubscriptionService = {
  async list(userId: string) {
    const subscriptions = await pushSubscriptionRepository.listActiveForUser(userId);

    // Endpoints are capability URLs — anyone holding one can push to the
    // device — so only a short suffix is returned, enough to identify a row.
    return subscriptions.map((subscription) => ({
      id: subscription.id,
      endpointSuffix: subscription.endpoint.slice(-16),
      userAgent: subscription.userAgent,
      createdAt: subscription.createdAt,
      lastUsedAt: subscription.lastUsedAt,
    }));
  },

  /** Registers a device. Idempotent per endpoint, so re-subscribing is safe. */
  async subscribe(
    userId: string,
    input: { endpoint: string; p256dh: string; auth: string; userAgent?: string },
  ) {
    const existing = await pushSubscriptionRepository.findByEndpoint(input.endpoint);

    if (!existing || existing.userId !== userId) {
      const count = await pushSubscriptionRepository.countForUser(userId);
      if (count >= NOTIFICATIONS.maxSubscriptionsPerUser) {
        throw AppError.badRequest(
          `You can register at most ${NOTIFICATIONS.maxSubscriptionsPerUser} devices`,
        );
      }
    }

    const subscription = await pushSubscriptionRepository.upsert({
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    });

    return { id: subscription.id, active: subscription.active };
  },

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    const removed = await pushSubscriptionRepository.removeByEndpoint(userId, endpoint);
    if (!removed) throw AppError.notFound('Subscription not found');
  },

  async history(userId: string, params: { page: number; limit: number }) {
    return notificationEventRepository.listForUser({
      userId,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    });
  },
};
