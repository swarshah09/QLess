import {
  Availability,
  Freshness,
  PressureUnit,
  QueueBucket,
  ReportSource,
  RuleConditionState,
  StationOperatorRole,
  UserRole,
} from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { notificationService, setPushTransport } from '../src/notifications/notification.service';
import type { PushOutcome, PushTransport } from '../src/notifications/webPush.transport';
import { recommendationService } from '../src/services/recommendation.service';
import { stationStateService } from '../src/services/stationState.service';
import { stationDiscoveryService } from '../src/services/stationDiscovery.service';
import {
  api,
  assignOperator,
  createAndLogin,
  createStation,
  createUser,
  disconnect,
  resetDatabase,
} from './helpers';

/**
 * Final acceptance regression.
 *
 * One test per product guarantee that must never silently break. These are the
 * invariants the whole platform rests on, not exhaustive feature coverage.
 */

const pushes: string[] = [];
setPushTransport({
  configured: true,
  async send(target): Promise<PushOutcome> {
    pushes.push(target.endpoint);
    return { ok: true };
  },
} satisfies PushTransport);

beforeEach(async () => {
  await resetDatabase();
  pushes.length = 0;
});
afterAll(disconnect);

const ORIGIN = { latitude: 23.0225, longitude: 72.5714 };
const STATION_COORDS = { latitude: 23.03, longitude: 72.57 };
const NEARBY = { latitude: 23.03045, longitude: 72.57015 };
const REMOTE = { latitude: 23.08, longitude: 72.57 };

describe('Crowd reporting', () => {
  it('a normal USER can report queue length', async () => {
    const station = await createStation(STATION_COORDS);
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7' });

    expect(response.status).toBe(201);
    expect(await prisma.queueReport.count()).toBe(1);
  });

  it('a normal USER can report CNG availability', async () => {
    const station = await createStation(STATION_COORDS);
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ availability: Availability.LOW_SUPPLY });

    expect(response.status).toBe(201);
    expect(await prisma.availabilityReport.count()).toBe(1);
  });

  it('an optional pressure report works', async () => {
    const station = await createStation(STATION_COORDS);
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '0-3', pressureValue: 205 });

    expect(response.status).toBe(201);
    expect(await prisma.pressureReport.count()).toBe(1);
  });

  it('the backend verifies reporting location', async () => {
    const station = await createStation(STATION_COORDS);
    const near = await createAndLogin();
    const far = await createAndLogin();

    const verified = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...near.authHeader)
      .send({ queueRange: '4-7', ...NEARBY });

    const unverified = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...far.authHeader)
      .send({ queueRange: '4-7', ...REMOTE });

    expect(verified.body.data.source).toBe(ReportSource.VERIFIED_NEARBY_USER);
    expect(unverified.body.data.source).toBe(ReportSource.NORMAL_USER);

    // A forged flag is rejected outright, not silently ignored.
    const forged = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...near.authHeader)
      .send({ queueRange: '4-7', ...REMOTE, locationVerified: true });
    expect(forged.status).toBe(422);
  });
});

describe('Core data guarantees', () => {
  it('nearest-first is the default ordering', async () => {
    const far = await createStation({ latitude: 23.0625, longitude: 72.5714 });
    const near = await createStation({ latitude: 23.0295, longitude: 72.5714 });

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000`,
    );

    expect(response.body.data.stations.map((s: { id: string }) => s.id)).toEqual([
      near.id,
      far.id,
    ]);
  });

  it('UNKNOWN is never zero', async () => {
    const station = await createStation(STATION_COORDS);
    const user = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: 'UNKNOWN', availability: Availability.AVAILABLE });

    const status = await prisma.stationStatus.findUnique({
      where: { stationId: station.id },
    });

    expect(status?.queueMin).toBeNull();
    expect(status?.queueMax).toBeNull();
    expect(status?.queueMin).not.toBe(0);
    expect(status?.waitMin).toBeNull();
  });

  it('stale is not served as live', async () => {
    const station = await createStation(STATION_COORDS);
    const user = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ availability: Availability.AVAILABLE, ...NEARBY });

    const fresh = await prisma.stationStatus.findUnique({
      where: { stationId: station.id },
    });
    expect(fresh?.freshness).toBe(Freshness.LIVE);

    const later = new Date(Date.now() + 45 * 60_000);
    const decayed = stationStateService.decay(fresh!, later);

    expect(decayed.freshness).toBe(Freshness.STALE);
    expect(decayed.confidence).toBeLessThan(fresh!.confidence);
  });

  it('a malicious outlier does not blindly control status', async () => {
    const station = await createStation(STATION_COORDS);

    // Four honest verified reporters.
    for (let i = 0; i < 4; i += 1) {
      const honest = await createUser();
      await prisma.queueReport.create({
        data: {
          stationId: station.id,
          userId: honest.id,
          queueMin: 4,
          queueMax: 7,
          queueBucket: QueueBucket.RANGE_4_7,
          source: ReportSource.VERIFIED_NEARBY_USER,
          locationVerified: true,
        },
      });
    }

    const attacker = await createUser();
    await prisma.queueReport.create({
      data: {
        stationId: station.id,
        userId: attacker.id,
        queueMin: 400,
        queueMax: 400,
        queueBucket: QueueBucket.RANGE_25_PLUS,
        source: ReportSource.NORMAL_USER,
        locationVerified: false,
      },
    });

    const { status, outlierCount } = await stationStateService.recompute(station.id);

    expect(outlierCount).toBeGreaterThan(0);
    expect(status.queueMax).toBeLessThan(40);
    // Downweighted, never deleted.
    expect(await prisma.queueReport.count({ where: { stationId: station.id } })).toBe(5);
  });

  it('historical reports remain preserved across recomputations', async () => {
    const station = await createStation(STATION_COORDS);
    const user = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7', availability: Availability.AVAILABLE, pressureValue: 200 });

    const before = await prisma.queueReport.findFirst();

    for (let i = 0; i < 3; i += 1) {
      await stationStateService.recompute(station.id);
    }

    const after = await prisma.queueReport.findUnique({ where: { id: before!.id } });

    expect(after).not.toBeNull();
    expect(after!.queueMin).toBe(before!.queueMin);
    expect(await prisma.queueReport.count()).toBe(1);
    expect(await prisma.availabilityReport.count()).toBe(1);
    expect(await prisma.pressureReport.count()).toBe(1);
  });
});

describe('Authorization', () => {
  it('an operator cannot modify an unassigned station', async () => {
    const assigned = await createStation();
    const other = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, assigned.id, StationOperatorRole.MANAGER);

    const allowed = await api()
      .post(`/api/v1/stations/${assigned.id}/operator-update`)
      .set(...operator.authHeader)
      .send({ availability: Availability.AVAILABLE });
    expect(allowed.status).toBe(201);

    const denied = await api()
      .post(`/api/v1/stations/${other.id}/operator-update`)
      .set(...operator.authHeader)
      .send({ availability: Availability.UNAVAILABLE });

    expect(denied.status).toBe(403);
    expect(
      await prisma.availabilityReport.count({ where: { stationId: other.id } }),
    ).toBe(0);
  });
});

describe('Notifications', () => {
  async function ruleSetup() {
    const user = await createUser();
    const station = await createStation(STATION_COORDS);

    await prisma.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: `https://push.example.com/${user.id}`,
        p256dh: 'k',
        auth: 'a',
      },
    });

    const rule = await prisma.notificationRule.create({
      data: { userId: user.id, stationId: station.id, maxQueue: 3, cooldownMinutes: 30 },
    });

    return { user, station, rule };
  }

  async function setMetStatus(stationId: string) {
    const data = {
      availability: Availability.AVAILABLE,
      queueMin: 0,
      queueMax: 3,
      queueBucket: QueueBucket.RANGE_0_3,
      waitMin: 2,
      waitMax: 6,
      pressureValue: 210,
      pressureUnit: PressureUnit.BAR,
      pressureStatus: 'NORMAL' as const,
      activeDispensers: 4,
      confidence: 90,
      freshness: Freshness.LIVE,
      computedAt: new Date(),
      lastOperatorUpdateAt: new Date(),
      lastUserUpdateAt: null,
    };
    return prisma.stationStatus.upsert({
      where: { stationId },
      create: { stationId, ...data },
      update: data,
    });
  }

  it('a notification transition does not spam', async () => {
    const { station } = await ruleSetup();

    await setMetStatus(station.id);
    await notificationService.evaluateStation(station.id);
    expect(pushes).toHaveLength(1);

    // Conditions still hold across further recomputations — no new edge.
    for (let i = 0; i < 3; i += 1) {
      await setMetStatus(station.id);
      await notificationService.evaluateStation(station.id);
    }

    expect(pushes).toHaveLength(1);
    expect(await prisma.notificationEvent.count()).toBe(1);
  });

  it('duplicate notification processing is idempotent', async () => {
    const { station, rule } = await ruleSetup();

    const status = await setMetStatus(station.id);
    await notificationService.evaluateStation(station.id);
    expect(await prisma.notificationEvent.count()).toBe(1);

    // Replay the same status change after resetting the rule state.
    await prisma.notificationRule.update({
      where: { id: rule.id },
      data: { currentConditionState: RuleConditionState.UNMET, cooldownUntil: null },
    });
    await notificationService.evaluateStation(station.id, { status });

    expect(await prisma.notificationEvent.count()).toBe(1);
  });

  it('an ambiguous queue range does not trigger', async () => {
    const { station, rule } = await ruleSetup();
    await prisma.notificationRule.update({ where: { id: rule.id }, data: { maxQueue: 5 } });

    // 4-7 does not guarantee <= 5.
    const status = await setMetStatus(station.id);
    await prisma.stationStatus.update({
      where: { stationId: station.id },
      data: { queueMin: 4, queueMax: 7, queueBucket: QueueBucket.RANGE_4_7 },
    });

    await notificationService.evaluateStation(station.id, {
      status: { ...status, queueMin: 4, queueMax: 7 },
    });

    expect(pushes).toHaveLength(0);
    expect(await prisma.notificationEvent.count()).toBe(0);
  });
});

describe('Recommendation', () => {
  it('does not recommend an unavailable station', async () => {
    const near = await createStation({ latitude: 23.0295, longitude: 72.5714 });
    const far = await createStation({ latitude: 23.0425, longitude: 72.5714 });

    const base = {
      queueMin: 0,
      queueMax: 3,
      queueBucket: QueueBucket.RANGE_0_3,
      waitMin: 2,
      waitMax: 6,
      pressureValue: 210,
      pressureUnit: PressureUnit.BAR,
      pressureStatus: 'NORMAL' as const,
      activeDispensers: 4,
      confidence: 90,
      freshness: Freshness.LIVE,
      computedAt: new Date(),
      lastOperatorUpdateAt: new Date(),
      lastUserUpdateAt: null,
    };

    await prisma.stationStatus.create({
      data: { stationId: near.id, ...base, availability: Availability.UNAVAILABLE },
    });
    await prisma.stationStatus.create({
      data: { stationId: far.id, ...base, availability: Availability.AVAILABLE },
    });

    const stations = await stationDiscoveryService.nearby({
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      radiusM: 20_000,
      limit: 10,
      filters: {},
    });

    const result = recommendationService.recommend(stations);

    expect(result.nearestStationId).toBe(near.id);
    expect(result.recommendedStationId).toBe(far.id);
  });

  it('may recommend a station that differs from the nearest', async () => {
    const near = await createStation({ latitude: 23.0295, longitude: 72.5714 });
    const far = await createStation({ latitude: 23.0625, longitude: 72.5714 });

    const base = {
      queueBucket: QueueBucket.RANGE_0_3,
      pressureValue: 210,
      pressureUnit: PressureUnit.BAR,
      pressureStatus: 'NORMAL' as const,
      activeDispensers: 4,
      confidence: 90,
      freshness: Freshness.LIVE,
      availability: Availability.AVAILABLE,
      computedAt: new Date(),
      lastOperatorUpdateAt: new Date(),
      lastUserUpdateAt: null,
    };

    await prisma.stationStatus.create({
      data: { stationId: near.id, ...base, queueMin: 16, queueMax: 25, waitMin: 45, waitMax: 60 },
    });
    await prisma.stationStatus.create({
      data: { stationId: far.id, ...base, queueMin: 0, queueMax: 3, waitMin: 2, waitMax: 5 },
    });

    const response = await api().get(
      `/api/v1/stations/recommendations?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000`,
    );

    // The list itself is still nearest-first.
    expect(response.body.data.stations.map((s: { id: string }) => s.id)).toEqual([
      near.id,
      far.id,
    ]);
    expect(response.body.data.recommendation.recommendedStationId).toBe(far.id);
    expect(response.body.data.recommendation.differsFromNearest).toBe(true);
  });
});

describe('Admin override auditing', () => {
  it('records admin identity, reason and timestamp, and preserves history', async () => {
    const admin = await createAndLogin({ role: UserRole.ADMIN });
    const station = await createStation(STATION_COORDS);
    const reporter = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...reporter.authHeader)
      .send({ queueRange: '16-25', availability: Availability.AVAILABLE, ...NEARBY });

    const historyBefore = await prisma.queueReport.count();

    const response = await api()
      .post(`/api/v1/admin/stations/${station.id}/override`)
      .set(...admin.authHeader)
      .send({
        availability: Availability.UNAVAILABLE,
        reason: 'Confirmed closed by phone with the station manager',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.overriddenAt).toBeTruthy();

    const entry = await prisma.adminAuditLog.findFirst({
      where: { action: 'STATION_STATUS_OVERRIDDEN' },
    });

    expect(entry).not.toBeNull();
    expect(entry!.adminUserId).toBe(admin.user.id);
    expect(entry!.reason).toContain('Confirmed closed');
    expect(entry!.createdAt).toBeInstanceOf(Date);
    expect(entry!.entityId).toBe(station.id);

    // The override added an ADMIN report; it did not rewrite the user's.
    expect(await prisma.queueReport.count()).toBe(historyBefore);
    const adminReport = await prisma.availabilityReport.findFirst({
      where: { source: ReportSource.ADMIN },
    });
    expect(adminReport).not.toBeNull();
  });

  it('rejects an override with no reason', async () => {
    const admin = await createAndLogin({ role: UserRole.ADMIN });
    const station = await createStation();

    const response = await api()
      .post(`/api/v1/admin/stations/${station.id}/override`)
      .set(...admin.authHeader)
      .send({ availability: Availability.UNAVAILABLE });

    expect(response.status).toBe(422);
    expect(await prisma.adminAuditLog.count()).toBe(0);
  });

  it('audits enable/disable with a reason and never deletes the station', async () => {
    const admin = await createAndLogin({ role: UserRole.ADMIN });
    const station = await createStation();

    const response = await api()
      .patch(`/api/v1/admin/stations/${station.id}/active`)
      .set(...admin.authHeader)
      .send({ active: false, reason: 'Closed for compressor replacement' });

    expect(response.status).toBe(200);
    expect(await prisma.station.findUnique({ where: { id: station.id } })).not.toBeNull();

    const entry = await prisma.adminAuditLog.findFirst({
      where: { action: 'STATION_DISABLED' },
    });
    expect(entry!.reason).toContain('compressor');
  });

  it('blocks non-admins from admin station routes', async () => {
    const station = await createStation();
    const user = await createAndLogin({ role: UserRole.USER });
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });

    for (const actor of [user, operator]) {
      const response = await api()
        .post(`/api/v1/admin/stations/${station.id}/override`)
        .set(...actor.authHeader)
        .send({ availability: Availability.UNAVAILABLE, reason: 'trying it on' });
      expect(response.status).toBe(403);
    }

    expect(
      (
        await api()
          .post(`/api/v1/admin/stations/${station.id}/override`)
          .send({ availability: Availability.UNAVAILABLE, reason: 'anonymous' })
      ).status,
    ).toBe(401);
  });
});

describe('Admin management surface', () => {
  it('creates, lists and updates stations', async () => {
    const admin = await createAndLogin({ role: UserRole.ADMIN });

    const created = await api()
      .post('/api/v1/admin/stations')
      .set(...admin.authHeader)
      .send({
        name: 'New Station',
        address: '1 Test Road',
        latitude: 23.03,
        longitude: 72.57,
        numberOfDispensers: 4,
      });
    expect(created.status).toBe(201);

    const listed = await api().get('/api/v1/admin/stations').set(...admin.authHeader);
    expect(listed.body.data.items).toHaveLength(1);
    expect(listed.body.data.pagination).toBeDefined();

    const updated = await api()
      .patch(`/api/v1/admin/stations/${created.body.data.station.id}`)
      .set(...admin.authHeader)
      .send({ numberOfDispensers: 8 });
    expect(updated.body.data.station.numberOfDispensers).toBe(8);
  });

  it('rejects incoherent pressure thresholds', async () => {
    const admin = await createAndLogin({ role: UserRole.ADMIN });

    const response = await api()
      .post('/api/v1/admin/stations')
      .set(...admin.authHeader)
      .send({
        name: 'Bad Thresholds',
        address: '2 Test Road',
        latitude: 23.03,
        longitude: 72.57,
        pressureThresholdLow: 220,
        pressureThresholdNormal: 180,
      });

    expect(response.status).toBe(422);
  });

  it('exposes statistics, suspicious reports, settings and audit logs', async () => {
    const admin = await createAndLogin({ role: UserRole.ADMIN });

    for (const path of [
      '/api/v1/admin/stats/reports',
      '/api/v1/admin/stats/notifications',
      '/api/v1/admin/reports/suspicious',
      '/api/v1/admin/settings',
      '/api/v1/admin/audit-logs',
    ]) {
      const response = await api().get(path).set(...admin.authHeader);
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    }
  });
});
