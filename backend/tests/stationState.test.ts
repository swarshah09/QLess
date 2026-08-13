import {
  Availability,
  Freshness,
  PressureUnit,
  QueueBucket,
  ReportSource,
} from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { stationStateService } from '../src/services/stationState.service';
import { createStation, createUser, disconnect, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(disconnect);

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function queueReport(params: {
  stationId: string;
  userId: string | null;
  source: ReportSource;
  min: number | null;
  max: number | null;
  bucket?: QueueBucket;
  createdAt?: Date;
}) {
  return prisma.queueReport.create({
    data: {
      stationId: params.stationId,
      userId: params.userId,
      queueMin: params.min,
      queueMax: params.max,
      queueBucket: params.bucket ?? QueueBucket.UNKNOWN,
      source: params.source,
      locationVerified: params.source === ReportSource.VERIFIED_NEARBY_USER,
      createdAt: params.createdAt ?? new Date(),
    },
  });
}

async function availabilityReport(params: {
  stationId: string;
  userId: string | null;
  source: ReportSource;
  availability: Availability;
  activeDispensers?: number;
  createdAt?: Date;
}) {
  return prisma.availabilityReport.create({
    data: {
      stationId: params.stationId,
      userId: params.userId,
      availability: params.availability,
      source: params.source,
      activeDispensers: params.activeDispensers ?? null,
      locationVerified: params.source !== ReportSource.NORMAL_USER,
      createdAt: params.createdAt ?? new Date(),
    },
  });
}

async function pressureReport(params: {
  stationId: string;
  userId: string | null;
  source: ReportSource;
  value: number;
  createdAt?: Date;
}) {
  return prisma.pressureReport.create({
    data: {
      stationId: params.stationId,
      userId: params.userId,
      pressureValue: params.value,
      pressureUnit: PressureUnit.BAR,
      source: params.source,
      locationVerified: true,
      createdAt: params.createdAt ?? new Date(),
    },
  });
}

describe('StationStateService: consensus, not the latest report', () => {
  it('does not simply take the newest report', async () => {
    const station = await createStation();
    const [a, b, c, d] = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
      createUser(),
    ]);

    // Three verified reporters agree on a long queue.
    for (const user of [a, b, c]) {
      await queueReport({
        stationId: station.id,
        userId: user.id,
        source: ReportSource.VERIFIED_NEARBY_USER,
        min: 16,
        max: 25,
        bucket: QueueBucket.RANGE_16_25,
        createdAt: minutesAgo(2),
      });
    }

    // The newest report is a lone remote user claiming it is empty.
    await queueReport({
      stationId: station.id,
      userId: d.id,
      source: ReportSource.NORMAL_USER,
      min: 0,
      max: 3,
      bucket: QueueBucket.RANGE_0_3,
      createdAt: new Date(),
    });

    const { status } = await stationStateService.recompute(station.id);

    // Blindly trusting the latest would give 0-3.
    expect(status.queueMin).toBeGreaterThan(8);
  });

  it('weights a verified nearby reporter above a remote one', async () => {
    const station = await createStation();
    const [near, far] = await Promise.all([createUser(), createUser()]);

    await availabilityReport({
      stationId: station.id,
      userId: near.id,
      source: ReportSource.VERIFIED_NEARBY_USER,
      availability: Availability.AVAILABLE,
    });
    await availabilityReport({
      stationId: station.id,
      userId: far.id,
      source: ReportSource.NORMAL_USER,
      availability: Availability.UNAVAILABLE,
    });

    const { status } = await stationStateService.recompute(station.id);
    expect(status.availability).toBe(Availability.AVAILABLE);
  });

  it('lets the operator override the crowd', async () => {
    const station = await createStation();
    const users = await Promise.all([createUser(), createUser(), createUser()]);
    const operator = await createUser();

    for (const user of users) {
      await availabilityReport({
        stationId: station.id,
        userId: user.id,
        source: ReportSource.VERIFIED_NEARBY_USER,
        availability: Availability.AVAILABLE,
        createdAt: minutesAgo(3),
      });
    }

    await availabilityReport({
      stationId: station.id,
      userId: operator.id,
      source: ReportSource.OPERATOR,
      availability: Availability.UNAVAILABLE,
    });

    const { status } = await stationStateService.recompute(station.id);
    expect(status.availability).toBe(Availability.UNAVAILABLE);
  });

  it('downweights an obvious queue outlier without deleting it', async () => {
    const station = await createStation();
    const users = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
      createUser(),
      createUser(),
    ]);

    for (const user of users.slice(0, 4)) {
      await queueReport({
        stationId: station.id,
        userId: user.id,
        source: ReportSource.VERIFIED_NEARBY_USER,
        min: 4,
        max: 7,
        bucket: QueueBucket.RANGE_4_7,
      });
    }

    await queueReport({
      stationId: station.id,
      userId: users[4].id,
      source: ReportSource.NORMAL_USER,
      min: 400,
      max: 400,
      bucket: QueueBucket.RANGE_25_PLUS,
    });

    const { status, outlierCount } = await stationStateService.recompute(station.id);

    expect(outlierCount).toBeGreaterThan(0);
    // Pulled a little by the outlier, but nowhere near it.
    expect(status.queueMax).toBeLessThan(40);
    // The raw report is untouched — downweighted, not deleted.
    expect(await prisma.queueReport.count({ where: { stationId: station.id } })).toBe(5);
  });

  it('never converts an unknown queue to zero', async () => {
    const station = await createStation();
    const user = await createUser();

    await availabilityReport({
      stationId: station.id,
      userId: user.id,
      source: ReportSource.VERIFIED_NEARBY_USER,
      availability: Availability.AVAILABLE,
    });

    const { status } = await stationStateService.recompute(station.id);

    expect(status.queueMin).toBeNull();
    expect(status.queueMax).toBeNull();
    expect(status.queueBucket).toBe(QueueBucket.UNKNOWN);
    // An unknown queue means an unknown wait, not a zero wait.
    expect(status.waitMin).toBeNull();
    expect(status.waitMax).toBeNull();
  });

  it('produces a range rather than a fabricated exact count', async () => {
    const station = await createStation();
    const user = await createUser();

    await queueReport({
      stationId: station.id,
      userId: user.id,
      source: ReportSource.VERIFIED_NEARBY_USER,
      min: 8,
      max: 15,
      bucket: QueueBucket.RANGE_8_15,
    });

    const { status } = await stationStateService.recompute(station.id);

    expect(status.queueMax!).toBeGreaterThan(status.queueMin!);
    expect(status.waitMax!).toBeGreaterThan(status.waitMin!);
  });

  it('classifies pressure using the station-specific thresholds', async () => {
    const strict = await createStation();
    const lenient = await createStation();

    await prisma.station.update({
      where: { id: strict.id },
      data: { pressureThresholdLow: 180, pressureThresholdNormal: 220 },
    });
    await prisma.station.update({
      where: { id: lenient.id },
      data: { pressureThresholdLow: 120, pressureThresholdNormal: 160 },
    });

    const user = await createUser();
    for (const station of [strict, lenient]) {
      await pressureReport({
        stationId: station.id,
        userId: user.id,
        source: ReportSource.OPERATOR,
        value: 170,
      });
    }

    const strictResult = await stationStateService.recompute(strict.id);
    const lenientResult = await stationStateService.recompute(lenient.id);

    expect(strictResult.status.pressureStatus).toBe('LOW');
    expect(lenientResult.status.pressureStatus).toBe('NORMAL');
  });

  it('ignores reports that have aged out of the window', async () => {
    const station = await createStation();
    const user = await createUser();

    await availabilityReport({
      stationId: station.id,
      userId: user.id,
      source: ReportSource.OPERATOR,
      availability: Availability.AVAILABLE,
      createdAt: minutesAgo(400),
    });

    const { status } = await stationStateService.recompute(station.id);

    expect(status.availability).toBe(Availability.UNKNOWN);
    expect(status.confidence).toBe(0);
  });

  it('lowers confidence as the newest input ages', async () => {
    const fresh = await createStation();
    const old = await createStation();
    const user = await createUser();

    await availabilityReport({
      stationId: fresh.id,
      userId: user.id,
      source: ReportSource.OPERATOR,
      availability: Availability.AVAILABLE,
      createdAt: minutesAgo(1),
    });
    await availabilityReport({
      stationId: old.id,
      userId: user.id,
      source: ReportSource.OPERATOR,
      availability: Availability.AVAILABLE,
      createdAt: minutesAgo(45),
    });

    const freshResult = await stationStateService.recompute(fresh.id);
    const oldResult = await stationStateService.recompute(old.id);

    expect(freshResult.status.freshness).toBe(Freshness.LIVE);
    expect(oldResult.status.freshness).toBe(Freshness.STALE);
    expect(oldResult.status.confidence).toBeLessThan(freshResult.status.confidence);
  });

  it('estimates wait from queue and observed dispensers', async () => {
    const station = await createStation();
    const operator = await createUser();

    await queueReport({
      stationId: station.id,
      userId: operator.id,
      source: ReportSource.OPERATOR,
      min: 16,
      max: 25,
      bucket: QueueBucket.RANGE_16_25,
    });
    await availabilityReport({
      stationId: station.id,
      userId: operator.id,
      source: ReportSource.OPERATOR,
      availability: Availability.AVAILABLE,
      activeDispensers: 2,
    });

    const { status } = await stationStateService.recompute(station.id);

    expect(status.activeDispensers).toBe(2);
    expect(status.waitMin).toBeGreaterThan(0);
    expect(status.waitMax!).toBeGreaterThan(status.waitMin!);
  });

  it('is deterministic for a fixed clock and fixed inputs', async () => {
    const station = await createStation();
    const user = await createUser();
    const now = new Date();

    await queueReport({
      stationId: station.id,
      userId: user.id,
      source: ReportSource.VERIFIED_NEARBY_USER,
      min: 4,
      max: 7,
      bucket: QueueBucket.RANGE_4_7,
      createdAt: minutesAgo(1),
    });

    const first = await stationStateService.recompute(station.id, {
      now,
      updateReputation: false,
    });
    const second = await stationStateService.recompute(station.id, {
      now,
      updateReputation: false,
    });

    expect(second.status.queueMin).toBe(first.status.queueMin);
    expect(second.status.queueMax).toBe(first.status.queueMax);
    expect(second.status.confidence).toBe(first.status.confidence);
    expect(second.status.freshness).toBe(first.status.freshness);
  });
});

describe('Status snapshots', () => {
  it('records an append-only snapshot on each recomputation', async () => {
    const station = await createStation();
    const user = await createUser();

    await availabilityReport({
      stationId: station.id,
      userId: user.id,
      source: ReportSource.OPERATOR,
      availability: Availability.AVAILABLE,
    });

    await stationStateService.recompute(station.id);
    await stationStateService.recompute(station.id);

    const snapshots = await prisma.stationStatusSnapshot.findMany({
      where: { stationId: station.id },
    });

    expect(snapshots).toHaveLength(2);
    // One mutable projection alongside the growing history.
    expect(await prisma.stationStatus.count({ where: { stationId: station.id } })).toBe(1);
  });

  it('captures the sample counts behind the computation', async () => {
    const station = await createStation();
    const user = await createUser();

    await queueReport({
      stationId: station.id,
      userId: user.id,
      source: ReportSource.VERIFIED_NEARBY_USER,
      min: 4,
      max: 7,
      bucket: QueueBucket.RANGE_4_7,
    });
    await pressureReport({
      stationId: station.id,
      userId: user.id,
      source: ReportSource.VERIFIED_NEARBY_USER,
      value: 200,
    });

    await stationStateService.recompute(station.id);

    const snapshot = await prisma.stationStatusSnapshot.findFirst({
      where: { stationId: station.id },
    });

    expect(snapshot?.queueSampleCount).toBe(1);
    expect(snapshot?.pressureSampleCount).toBe(1);
  });

  it('can be skipped when a snapshot is not wanted', async () => {
    const station = await createStation();
    await stationStateService.recompute(station.id, { snapshot: false });
    expect(await prisma.stationStatusSnapshot.count()).toBe(0);
  });
});

describe('Time-based decay without new reports', () => {
  it('re-derives a stale band on read', async () => {
    const station = await createStation();
    const user = await createUser();

    await availabilityReport({
      stationId: station.id,
      userId: user.id,
      source: ReportSource.OPERATOR,
      availability: Availability.AVAILABLE,
    });

    const { status } = await stationStateService.recompute(station.id);
    expect(status.freshness).toBe(Freshness.LIVE);

    // No new reports; only the clock has moved.
    const later = new Date(Date.now() + 40 * 60_000);
    const decayed = stationStateService.decay(status, later);

    expect(decayed.freshness).toBe(Freshness.STALE);
    expect(decayed.confidence).toBeLessThan(status.confidence);
    // The stored row is untouched — decay is a read-time projection.
    expect(status.freshness).toBe(Freshness.LIVE);
  });

  it('leaves a still-fresh status unchanged', async () => {
    const station = await createStation();
    const user = await createUser();

    await availabilityReport({
      stationId: station.id,
      userId: user.id,
      source: ReportSource.OPERATOR,
      availability: Availability.AVAILABLE,
    });

    const { status } = await stationStateService.recompute(station.id);
    const decayed = stationStateService.decay(status, new Date(Date.now() + 60_000));

    expect(decayed.freshness).toBe(status.freshness);
    expect(decayed.confidence).toBe(status.confidence);
  });
});

describe('Reporter reputation integration', () => {
  it('rewards agreeing with the consensus and penalises the outlier', async () => {
    const station = await createStation();
    const agreeing = await Promise.all([createUser(), createUser(), createUser()]);
    const dissenter = await createUser();

    for (const user of agreeing) {
      await availabilityReport({
        stationId: station.id,
        userId: user.id,
        source: ReportSource.VERIFIED_NEARBY_USER,
        availability: Availability.AVAILABLE,
      });
    }

    await availabilityReport({
      stationId: station.id,
      userId: dissenter.id,
      source: ReportSource.NORMAL_USER,
      availability: Availability.UNAVAILABLE,
    });

    await stationStateService.recompute(station.id);

    const [agreed, disagreed] = await Promise.all([
      prisma.reporterReputation.findUnique({ where: { userId: agreeing[0].id } }),
      prisma.reporterReputation.findUnique({ where: { userId: dissenter.id } }),
    ]);

    expect(agreed).not.toBeNull();
    expect(agreed!.score).toBeGreaterThan(50);
    expect(agreed!.verifiedReports).toBe(1);

    expect(disagreed!.score).toBeLessThan(50);
  });

  it('moves scores gradually rather than in one jump', async () => {
    const station = await createStation();
    const users = await Promise.all([createUser(), createUser(), createUser()]);

    for (const user of users) {
      await availabilityReport({
        stationId: station.id,
        userId: user.id,
        source: ReportSource.VERIFIED_NEARBY_USER,
        availability: Availability.AVAILABLE,
      });
    }

    await stationStateService.recompute(station.id);

    const reputation = await prisma.reporterReputation.findUnique({
      where: { userId: users[0].id },
    });

    // Well short of the 100 target after a single good report.
    expect(reputation!.score).toBeLessThan(60);
    expect(reputation!.score).toBeGreaterThan(50);
  });

  it('can be skipped', async () => {
    const station = await createStation();
    const user = await createUser();

    await availabilityReport({
      stationId: station.id,
      userId: user.id,
      source: ReportSource.VERIFIED_NEARBY_USER,
      availability: Availability.AVAILABLE,
    });

    await stationStateService.recompute(station.id, { updateReputation: false });
    expect(await prisma.reporterReputation.count()).toBe(0);
  });
});

describe('Raw reports are preserved', () => {
  it('never mutates or deletes reports during recomputation', async () => {
    const station = await createStation();
    const user = await createUser();

    const report = await queueReport({
      stationId: station.id,
      userId: user.id,
      source: ReportSource.VERIFIED_NEARBY_USER,
      min: 4,
      max: 7,
      bucket: QueueBucket.RANGE_4_7,
    });

    for (let i = 0; i < 3; i += 1) {
      await stationStateService.recompute(station.id);
    }

    const after = await prisma.queueReport.findUnique({ where: { id: report.id } });

    expect(after).not.toBeNull();
    expect(after!.queueMin).toBe(report.queueMin);
    expect(after!.queueMax).toBe(report.queueMax);
    expect(after!.createdAt.getTime()).toBe(report.createdAt.getTime());
    expect(await prisma.queueReport.count()).toBe(1);
  });
});
