import type {
  Availability,
  NotificationChannel,
  NotificationEvent,
  NotificationEventStatus,
  NotificationRule,
  Prisma,
  PressureUnit,
  PushSubscription,
  RuleConditionState,
} from '@prisma/client';
import { prisma } from '../config/prisma';

export const notificationRuleRepository = {
  async findById(id: string): Promise<NotificationRule | null> {
    return prisma.notificationRule.findUnique({ where: { id } });
  },

  async listForUser(userId: string) {
    return prisma.notificationRule.findMany({
      where: { userId },
      include: {
        station: { select: { id: true, name: true, address: true, city: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Active rules for ONE station.
   *
   * Scoped by `stationId` deliberately: evaluation is triggered by a status
   * change, and only rules watching that station can be affected. Nothing here
   * ever scans the rule table globally.
   */
  async listActiveForStation(stationId: string): Promise<NotificationRule[]> {
    return prisma.notificationRule.findMany({
      where: { stationId, enabled: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  async countForUser(userId: string): Promise<number> {
    return prisma.notificationRule.count({ where: { userId } });
  },

  async create(data: {
    userId: string;
    stationId: string;
    requiredAvailability: Availability[];
    maxQueue?: number | null;
    maxWaitMinutes?: number | null;
    minPressure?: number | null;
    pressureUnit?: PressureUnit;
    channel?: NotificationChannel;
    enabled?: boolean;
    cooldownMinutes?: number;
  }): Promise<NotificationRule> {
    return prisma.notificationRule.create({ data });
  },

  async update(id: string, data: Prisma.NotificationRuleUpdateInput): Promise<NotificationRule> {
    return prisma.notificationRule.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.notificationRule.delete({ where: { id } });
  },

  /**
   * Records the outcome of an evaluation.
   *
   * `expectedState` makes the write a compare-and-set: if a concurrent
   * evaluation already moved the rule, this update matches nothing and the
   * caller learns it lost the race. That is what stops two simultaneous
   * recomputations both seeing FALSE→TRUE and both sending.
   */
  async transitionState(params: {
    id: string;
    expectedState: RuleConditionState;
    nextState: RuleConditionState;
    evaluatedAt: Date;
    triggeredAt?: Date | null;
    cooldownUntil?: Date | null;
  }): Promise<boolean> {
    const result = await prisma.notificationRule.updateMany({
      where: { id: params.id, currentConditionState: params.expectedState },
      data: {
        currentConditionState: params.nextState,
        lastEvaluatedAt: params.evaluatedAt,
        ...(params.triggeredAt !== undefined && { lastTriggeredAt: params.triggeredAt }),
        ...(params.cooldownUntil !== undefined && { cooldownUntil: params.cooldownUntil }),
      },
    });

    return result.count > 0;
  },

  /** Records an evaluation that produced no transition. */
  async touchEvaluated(id: string, evaluatedAt: Date): Promise<void> {
    await prisma.notificationRule.updateMany({
      where: { id },
      data: { lastEvaluatedAt: evaluatedAt },
    });
  },
};

export const pushSubscriptionRepository = {
  async listActiveForUser(userId: string): Promise<PushSubscription[]> {
    return prisma.pushSubscription.findMany({
      where: { userId, active: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  async countForUser(userId: string): Promise<number> {
    return prisma.pushSubscription.count({ where: { userId, active: true } });
  },

  async findByEndpoint(endpoint: string): Promise<PushSubscription | null> {
    return prisma.pushSubscription.findUnique({ where: { endpoint } });
  },

  /**
   * Registers a device. Upserting on the endpoint means a browser re-sending an
   * existing subscription refreshes it instead of colliding, and reclaims one
   * that was previously deactivated.
   */
  async upsert(data: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
  }): Promise<PushSubscription> {
    return prisma.pushSubscription.upsert({
      where: { endpoint: data.endpoint },
      create: {
        userId: data.userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        userAgent: data.userAgent ?? null,
      },
      update: {
        // Endpoints can be reassigned to a different profile on a shared
        // device, so ownership is refreshed too.
        userId: data.userId,
        p256dh: data.p256dh,
        auth: data.auth,
        userAgent: data.userAgent ?? null,
        active: true,
      },
    });
  },

  async deactivate(id: string, reason: string): Promise<void> {
    await prisma.pushSubscription.updateMany({
      where: { id },
      data: { active: false, userAgent: reason.slice(0, 400) },
    });
  },

  async markUsed(id: string): Promise<void> {
    await prisma.pushSubscription.updateMany({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  },

  async removeByEndpoint(userId: string, endpoint: string): Promise<boolean> {
    const result = await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return result.count > 0;
  },
};

export const notificationEventRepository = {
  /**
   * Creates an event, or returns null when one already exists for this
   * dedupe key.
   *
   * The uniqueness is enforced by the database, not by a prior read: two
   * concurrent workers can both check-and-miss, but only one insert can win.
   */
  async createIfAbsent(data: {
    dedupeKey: string;
    userId: string;
    ruleId: string;
    stationId: string;
    channel: NotificationChannel;
    title: string;
    body: string;
    payload: Prisma.InputJsonValue;
    triggerSnapshot: Prisma.InputJsonValue;
  }): Promise<NotificationEvent | null> {
    try {
      return await prisma.notificationEvent.create({ data });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return null;
      throw error;
    }
  },

  async findByDedupeKey(dedupeKey: string): Promise<NotificationEvent | null> {
    return prisma.notificationEvent.findUnique({ where: { dedupeKey } });
  },

  async markSent(id: string, subscriptionId: string | null): Promise<void> {
    await prisma.notificationEvent.update({
      where: { id },
      data: {
        status: 'SENT' satisfies NotificationEventStatus,
        sentAt: new Date(),
        subscriptionId,
        attempts: { increment: 1 },
      },
    });
  },

  async markFailed(id: string, error: string): Promise<void> {
    await prisma.notificationEvent.update({
      where: { id },
      data: {
        status: 'FAILED' satisfies NotificationEventStatus,
        error: error.slice(0, 1000),
        attempts: { increment: 1 },
      },
    });
  },

  async markSuppressed(id: string, reason: string): Promise<void> {
    await prisma.notificationEvent.update({
      where: { id },
      data: {
        status: 'SUPPRESSED' satisfies NotificationEventStatus,
        error: reason.slice(0, 1000),
      },
    });
  },

  async listForUser(params: { userId: string; skip: number; take: number }) {
    const where = { userId: params.userId };

    const [items, total] = await Promise.all([
      prisma.notificationEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.notificationEvent.count({ where }),
    ]);

    return { items, total };
  },

  /** Pending work, for a future queue worker to drain. */
  async listPending(limit: number): Promise<NotificationEvent[]> {
    return prisma.notificationEvent.findMany({
      where: { status: 'PENDING', scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
    });
  },
};
