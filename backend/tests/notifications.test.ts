import {
  Availability,
  Freshness,
  NotificationChannel,
  PressureUnit,
  QueueBucket,
  RuleConditionState,
  type StationStatus,
} from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import {
  notificationService,
  setPushTransport,
} from '../src/notifications/notification.service';
import { ruleEvaluator } from '../src/notifications/ruleEvaluator';
import type { PushOutcome, PushTarget, PushTransport } from '../src/notifications/webPush.transport';
import {
  api,
  createAndLogin,
  createStation,
  createUser,
  disconnect,
  resetDatabase,
} from './helpers';

/** Records deliveries instead of hitting a real push service. */
const sent: Array<{ endpoint: string; payload: unknown }> = [];
let nextOutcome: PushOutcome = { ok: true };

const recordingTransport: PushTransport = {
  configured: true,
  async send(target: PushTarget, payload: unknown): Promise<PushOutcome> {
    sent.push({ endpoint: target.endpoint, payload });
    return nextOutcome;
  },
};

setPushTransport(recordingTransport);

beforeEach(async () => {
  await resetDatabase();
  sent.length = 0;
  nextOutcome = { ok: true };
});
afterAll(disconnect);

/** Writes a StationStatus directly — these tests target the engine, not Part 4. */
async function setStatus(
  stationId: string,
  overrides: Partial<StationStatus> = {},
): Promise<StationStatus> {
  const data = {
    availability: Availability.AVAILABLE,
    queueMin: 0,
    queueMax: 3,
    queueBucket: QueueBucket.RANGE_0_3,
    waitMin: 5,
    waitMax: 10,
    pressureValue: 210,
    pressureUnit: PressureUnit.BAR,
    pressureStatus: 'NORMAL' as const,
    activeDispensers: 4,
    confidence: 90,
    freshness: Freshness.LIVE,
    computedAt: new Date(),
    lastOperatorUpdateAt: new Date(),
    lastUserUpdateAt: null,
    ...overrides,
  };

  return prisma.stationStatus.upsert({
    where: { stationId },
    create: { stationId, ...data },
    update: data,
  });
}

async function createRule(
  userId: string,
  stationId: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.notificationRule.create({
    data: {
      userId,
      stationId,
      requiredAvailability: [Availability.AVAILABLE],
      cooldownMinutes: 30,
      channel: NotificationChannel.WEB_PUSH,
      ...overrides,
    },
  });
}

async function addDevice(userId: string, suffix = '1') {
  return prisma.pushSubscription.create({
    data: {
      userId,
      endpoint: `https://push.example.com/endpoint-${userId}-${suffix}`,
      p256dh: `p256dh-${suffix}`,
      auth: `auth-${suffix}`,
    },
  });
}

// ---------------------------------------------------------------------------

describe('Conservative threshold semantics', () => {
  const baseRule = {
    id: 'r',
    stationId: 's',
    userId: 'u',
    requiredAvailability: [],
    maxQueue: null,
    maxWaitMinutes: null,
    minPressure: null,
    pressureUnit: PressureUnit.BAR,
    channel: NotificationChannel.WEB_PUSH,
    enabled: true,
    currentConditionState: RuleConditionState.UNMET,
    cooldownMinutes: 30,
  } as never;

  const baseStatus = {
    availability: Availability.AVAILABLE,
    queueMin: 4,
    queueMax: 7,
    waitMin: 5,
    waitMax: 10,
    pressureValue: 200,
    pressureUnit: PressureUnit.BAR,
    confidence: 90,
    freshness: Freshness.LIVE,
    computedAt: new Date(),
  } as never;

  it('does NOT trigger when the range does not guarantee the threshold', () => {
    // The stated requirement: user wants <= 5, range is 4-7. The queue might be
    // 7, so the condition is not guaranteed.
    const result = ruleEvaluator.evaluate(
      { ...(baseRule as object), maxQueue: 5 } as never,
      baseStatus,
    );
    expect(result.met).toBe(false);
  });

  it('triggers when the whole range satisfies the threshold', () => {
    const result = ruleEvaluator.evaluate(
      { ...(baseRule as object), maxQueue: 7 } as never,
      baseStatus,
    );
    expect(result.met).toBe(true);
  });

  it('never treats an unknown queue as small', () => {
    const result = ruleEvaluator.evaluate(
      { ...(baseRule as object), maxQueue: 5 } as never,
      { ...(baseStatus as object), queueMin: null, queueMax: null } as never,
    );
    expect(result.met).toBe(false);
  });

  it('applies the same rule to wait', () => {
    const notGuaranteed = ruleEvaluator.evaluate(
      { ...(baseRule as object), maxWaitMinutes: 8 } as never,
      baseStatus,
    );
    const guaranteed = ruleEvaluator.evaluate(
      { ...(baseRule as object), maxWaitMinutes: 10 } as never,
      baseStatus,
    );

    expect(notGuaranteed.met).toBe(false);
    expect(guaranteed.met).toBe(true);
  });

  it('never satisfies a minimum pressure from an unknown reading', () => {
    const result = ruleEvaluator.evaluate(
      { ...(baseRule as object), minPressure: 180 } as never,
      { ...(baseStatus as object), pressureValue: null } as never,
    );
    expect(result.met).toBe(false);
  });

  it('never satisfies an availability requirement from UNKNOWN', () => {
    const result = ruleEvaluator.evaluate(
      { ...(baseRule as object), requiredAvailability: [Availability.AVAILABLE] } as never,
      { ...(baseStatus as object), availability: Availability.UNKNOWN } as never,
    );
    expect(result.met).toBe(false);
  });

  it('combines selected conditions with AND', () => {
    const rule = {
      ...(baseRule as object),
      requiredAvailability: [Availability.AVAILABLE],
      maxQueue: 7,
      maxWaitMinutes: 10,
      minPressure: 190,
    } as never;

    expect(ruleEvaluator.evaluate(rule, baseStatus).met).toBe(true);

    // Any single failing condition fails the whole rule.
    expect(
      ruleEvaluator.evaluate(rule, {
        ...(baseStatus as object),
        pressureValue: 150,
      } as never).met,
    ).toBe(false);
    expect(
      ruleEvaluator.evaluate(rule, {
        ...(baseStatus as object),
        availability: Availability.LOW_SUPPLY,
      } as never).met,
    ).toBe(false);
    expect(
      ruleEvaluator.evaluate(rule, { ...(baseStatus as object), queueMax: 20 } as never).met,
    ).toBe(false);
  });

  it('refuses to notify on stale or low-confidence data', () => {
    const rule = { ...(baseRule as object), maxQueue: 7 } as never;

    expect(
      ruleEvaluator.evaluate(rule, {
        ...(baseStatus as object),
        freshness: Freshness.STALE,
      } as never).met,
    ).toBe(false);
    expect(
      ruleEvaluator.evaluate(rule, { ...(baseStatus as object), confidence: 10 } as never).met,
    ).toBe(false);
  });
});

describe('State transitions', () => {
  it('FALSE → TRUE sends exactly once', async () => {
    const user = await createUser();
    const station = await createStation();
    await addDevice(user.id);
    await createRule(user.id, station.id, {
      maxQueue: 3,
      currentConditionState: RuleConditionState.UNMET,
    });

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    const summary = await notificationService.evaluateStation(station.id);

    expect(summary.eventsCreated).toBe(1);
    expect(sent).toHaveLength(1);

    const events = await prisma.notificationEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('SENT');
  });

  it('TRUE → TRUE does not resend', async () => {
    const user = await createUser();
    const station = await createStation();
    await addDevice(user.id);
    await createRule(user.id, station.id, { maxQueue: 3 });

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    await notificationService.evaluateStation(station.id);
    expect(sent).toHaveLength(1);

    // Conditions still hold; a new computation, but no fresh edge.
    await setStatus(station.id, { queueMin: 0, queueMax: 3, computedAt: new Date() });
    const second = await notificationService.evaluateStation(station.id);

    expect(second.eventsCreated).toBe(0);
    expect(sent).toHaveLength(1);
    expect(await prisma.notificationEvent.count()).toBe(1);
  });

  it('TRUE → FALSE does not send', async () => {
    const user = await createUser();
    const station = await createStation();
    await addDevice(user.id);
    await createRule(user.id, station.id, { maxQueue: 3 });

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    await notificationService.evaluateStation(station.id);
    sent.length = 0;

    await setStatus(station.id, {
      queueMin: 16,
      queueMax: 25,
      computedAt: new Date(),
    });
    const summary = await notificationService.evaluateStation(station.id);

    expect(summary.eventsCreated).toBe(0);
    expect(sent).toHaveLength(0);

    const rule = await prisma.notificationRule.findFirst();
    expect(rule?.currentConditionState).toBe(RuleConditionState.UNMET);
  });

  it('FALSE → TRUE again sends once the cooldown has passed', async () => {
    const user = await createUser();
    const station = await createStation();
    await addDevice(user.id);
    await createRule(user.id, station.id, { maxQueue: 3, cooldownMinutes: 30 });

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    await notificationService.evaluateStation(station.id);
    expect(sent).toHaveLength(1);

    // Drop out of MET.
    await setStatus(station.id, { queueMin: 16, queueMax: 25, computedAt: new Date() });
    await notificationService.evaluateStation(station.id);

    // Back into MET, after the cooldown window.
    const later = new Date(Date.now() + 40 * 60_000);
    await setStatus(station.id, { queueMin: 0, queueMax: 3, computedAt: later });
    const summary = await notificationService.evaluateStation(station.id, { now: later });

    expect(summary.eventsCreated).toBe(1);
    expect(sent).toHaveLength(2);
  });
});

describe('Cooldown', () => {
  it('suppresses a re-trigger inside the cooldown window', async () => {
    const user = await createUser();
    const station = await createStation();
    await addDevice(user.id);
    await createRule(user.id, station.id, { maxQueue: 3, cooldownMinutes: 60 });

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    await notificationService.evaluateStation(station.id);
    expect(sent).toHaveLength(1);

    // Out and back in, still well inside the cooldown.
    await setStatus(station.id, { queueMin: 16, queueMax: 25, computedAt: new Date() });
    await notificationService.evaluateStation(station.id);

    const soon = new Date(Date.now() + 5 * 60_000);
    await setStatus(station.id, { queueMin: 0, queueMax: 3, computedAt: soon });
    const summary = await notificationService.evaluateStation(station.id, { now: soon });

    expect(summary.transitionsToMet).toBe(1);
    expect(summary.suppressedByCooldown).toBe(1);
    expect(summary.eventsCreated).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('records the cooldown expiry when it fires', async () => {
    const user = await createUser();
    const station = await createStation();
    await addDevice(user.id);
    await createRule(user.id, station.id, { maxQueue: 3, cooldownMinutes: 45 });

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    await notificationService.evaluateStation(station.id);

    const rule = await prisma.notificationRule.findFirst();
    expect(rule?.lastTriggeredAt).not.toBeNull();
    expect(rule?.cooldownUntil).not.toBeNull();
    expect(rule!.cooldownUntil!.getTime()).toBeGreaterThan(Date.now() + 40 * 60_000);
  });
});

describe('Idempotency and duplicate prevention', () => {
  it('does not duplicate an event when the same change is processed twice', async () => {
    const user = await createUser();
    const station = await createStation();
    await addDevice(user.id);
    const rule = await createRule(user.id, station.id, { maxQueue: 3 });

    const status = await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    await notificationService.evaluateStation(station.id);
    expect(await prisma.notificationEvent.count()).toBe(1);

    // Simulate a replayed job: reset the rule state so the transition is seen
    // again, but keep the SAME status (same computedAt).
    await prisma.notificationRule.update({
      where: { id: rule.id },
      data: { currentConditionState: RuleConditionState.UNMET, cooldownUntil: null },
    });

    const second = await notificationService.evaluateStation(station.id, { status });

    // The dedupe key is identical, so the insert is rejected.
    expect(second.eventsCreated).toBe(0);
    expect(await prisma.notificationEvent.count()).toBe(1);
  });

  it('enforces dedupe at the database level', async () => {
    const user = await createUser();
    const station = await createStation();

    const shared = {
      dedupeKey: 'fixed-key',
      userId: user.id,
      stationId: station.id,
      title: 'T',
      body: 'B',
    };

    await prisma.notificationEvent.create({ data: shared });
    await expect(prisma.notificationEvent.create({ data: shared })).rejects.toThrow();
  });
});

describe('Disabled and deleted rules', () => {
  it('does not evaluate a disabled rule', async () => {
    const user = await createUser();
    const station = await createStation();
    await addDevice(user.id);
    await createRule(user.id, station.id, { maxQueue: 3, enabled: false });

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    const summary = await notificationService.evaluateStation(station.id);

    expect(summary.rulesEvaluated).toBe(0);
    expect(summary.eventsCreated).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('does not trigger a deleted rule', async () => {
    const user = await createUser();
    const station = await createStation();
    await addDevice(user.id);
    const rule = await createRule(user.id, station.id, { maxQueue: 3 });

    await prisma.notificationRule.delete({ where: { id: rule.id } });

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    const summary = await notificationService.evaluateStation(station.id);

    expect(summary.rulesEvaluated).toBe(0);
    expect(await prisma.notificationEvent.count()).toBe(0);
  });

  it('only evaluates rules for the affected station', async () => {
    const user = await createUser();
    const watched = await createStation();
    const other = await createStation();
    await addDevice(user.id);

    await createRule(user.id, watched.id, { maxQueue: 3 });
    await createRule(user.id, other.id, { maxQueue: 3 });

    await setStatus(watched.id, { queueMin: 0, queueMax: 3 });
    await setStatus(other.id, { queueMin: 0, queueMax: 3 });

    const summary = await notificationService.evaluateStation(watched.id);

    expect(summary.rulesEvaluated).toBe(1);
    expect(summary.eventsCreated).toBe(1);
  });
});

describe('Delivery', () => {
  it('sends to every registered device', async () => {
    const user = await createUser();
    const station = await createStation();
    await addDevice(user.id, 'phone');
    await addDevice(user.id, 'laptop');
    await createRule(user.id, station.id, { maxQueue: 3 });

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    await notificationService.evaluateStation(station.id);

    expect(sent).toHaveLength(2);
    expect(await prisma.notificationEvent.count({ where: { status: 'SENT' } })).toBe(1);
  });

  it('deactivates a subscription the push service reports as gone', async () => {
    const user = await createUser();
    const station = await createStation();
    const device = await addDevice(user.id);
    await createRule(user.id, station.id, { maxQueue: 3 });

    nextOutcome = { ok: false, retryable: false, gone: true, error: 'Gone', statusCode: 410 };

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    await notificationService.evaluateStation(station.id);

    const after = await prisma.pushSubscription.findUnique({ where: { id: device.id } });
    expect(after?.active).toBe(false);

    const event = await prisma.notificationEvent.findFirst();
    expect(event?.status).toBe('FAILED');
  });

  it('suppresses when the user has no devices', async () => {
    const user = await createUser();
    const station = await createStation();
    await createRule(user.id, station.id, { maxQueue: 3 });

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    await notificationService.evaluateStation(station.id);

    const event = await prisma.notificationEvent.findFirst();
    expect(event?.status).toBe('SUPPRESSED');
    expect(sent).toHaveLength(0);
  });

  it('includes the station deep link in the payload', async () => {
    const user = await createUser();
    const station = await createStation({ name: 'Shree CNG' });
    await addDevice(user.id);
    await createRule(user.id, station.id, { maxQueue: 3 });

    await setStatus(station.id, { queueMin: 0, queueMax: 3 });
    await notificationService.evaluateStation(station.id);

    const event = await prisma.notificationEvent.findFirst();
    const payload = event!.payload as { url: string };

    expect(payload.url).toBe(`/stations/${station.id}`);
    expect(event!.title).toBe('Good time to refuel ⛽');
    expect(event!.body).toContain('Shree CNG');
  });
});

describe('Rule API', () => {
  it('creates, lists, updates and deletes a rule', async () => {
    const user = await createAndLogin();
    const station = await createStation();

    const created = await api()
      .post('/api/v1/notifications/rules')
      .set(...user.authHeader)
      .send({ stationId: station.id, maxQueue: 5, requiredAvailability: ['AVAILABLE'] });
    expect(created.status).toBe(201);

    const ruleId = created.body.data.rule.id;

    const listed = await api()
      .get('/api/v1/notifications/rules')
      .set(...user.authHeader);
    expect(listed.body.data.rules).toHaveLength(1);

    const updated = await api()
      .patch(`/api/v1/notifications/rules/${ruleId}`)
      .set(...user.authHeader)
      .send({ maxQueue: 3, enabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.rule.maxQueue).toBe(3);
    expect(updated.body.data.rule.enabled).toBe(false);

    const deleted = await api()
      .delete(`/api/v1/notifications/rules/${ruleId}`)
      .set(...user.authHeader);
    expect(deleted.status).toBe(200);
    expect(await prisma.notificationRule.count()).toBe(0);
  });

  it('rejects a rule with no conditions', async () => {
    const user = await createAndLogin();
    const station = await createStation();

    const response = await api()
      .post('/api/v1/notifications/rules')
      .set(...user.authHeader)
      .send({ stationId: station.id });

    expect(response.status).toBe(400);
  });

  it('does not expose another user’s rule', async () => {
    const owner = await createAndLogin();
    const other = await createAndLogin();
    const station = await createStation();

    const created = await api()
      .post('/api/v1/notifications/rules')
      .set(...owner.authHeader)
      .send({ stationId: station.id, maxQueue: 5 });

    const ruleId = created.body.data.rule.id;

    const attempt = await api()
      .patch(`/api/v1/notifications/rules/${ruleId}`)
      .set(...other.authHeader)
      .send({ maxQueue: 1 });

    expect(attempt.status).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await api().get('/api/v1/notifications/rules')).status).toBe(401);
  });

  it('resets transition state when conditions change', async () => {
    const user = await createAndLogin();
    const station = await createStation();

    const created = await api()
      .post('/api/v1/notifications/rules')
      .set(...user.authHeader)
      .send({ stationId: station.id, maxQueue: 3 });

    const ruleId = created.body.data.rule.id;
    await prisma.notificationRule.update({
      where: { id: ruleId },
      data: { currentConditionState: RuleConditionState.MET },
    });

    await api()
      .patch(`/api/v1/notifications/rules/${ruleId}`)
      .set(...user.authHeader)
      .send({ maxQueue: 15 });

    // Otherwise the rule would sit at MET under the new threshold and never
    // produce the edge the user is now waiting for.
    const rule = await prisma.notificationRule.findUnique({ where: { id: ruleId } });
    expect(rule?.currentConditionState).toBe(RuleConditionState.UNKNOWN);
  });
});

describe('Push subscription API', () => {
  it('registers, lists and removes a device', async () => {
    const user = await createAndLogin();

    const subscribed = await api()
      .post('/api/v1/notifications/subscriptions')
      .set(...user.authHeader)
      .send({
        endpoint: 'https://push.example.com/abc123',
        keys: { p256dh: 'key', auth: 'secret' },
      });
    expect(subscribed.status).toBe(201);

    const listed = await api()
      .get('/api/v1/notifications/subscriptions')
      .set(...user.authHeader);
    expect(listed.body.data.subscriptions).toHaveLength(1);
    // The endpoint is a capability URL, so only a suffix is returned.
    expect(JSON.stringify(listed.body)).not.toContain('https://push.example.com/abc123');

    const removed = await api()
      .delete('/api/v1/notifications/subscriptions')
      .set(...user.authHeader)
      .send({ endpoint: 'https://push.example.com/abc123' });
    expect(removed.status).toBe(200);
  });

  it('is idempotent for a repeated endpoint', async () => {
    const user = await createAndLogin();
    const body = {
      endpoint: 'https://push.example.com/same',
      keys: { p256dh: 'key', auth: 'secret' },
    };

    await api()
      .post('/api/v1/notifications/subscriptions')
      .set(...user.authHeader)
      .send(body);
    await api()
      .post('/api/v1/notifications/subscriptions')
      .set(...user.authHeader)
      .send(body);

    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it('exposes the VAPID public key without authentication', async () => {
    const response = await api().get('/api/v1/notifications/vapid-public-key');
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty('configured');
  });
});
