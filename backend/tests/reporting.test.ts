import { Availability, ReportSource, UserRole } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import {
  api,
  createAndLogin,
  createStation,
  disconnect,
  resetDatabase,
} from './helpers';

beforeEach(resetDatabase);
afterAll(disconnect);

/** The default geofence is 200 m; these offsets sit clearly either side of it. */
const STATION_COORDS = { latitude: 23.0300, longitude: 72.5700 };
/** ~55 m away — comfortably inside the geofence. */
const NEARBY_COORDS = { latitude: 23.03045, longitude: 72.57015 };
/** ~5.5 km away — clearly outside. */
const REMOTE_COORDS = { latitude: 23.0800, longitude: 72.5700 };

async function stationAt() {
  return createStation({
    latitude: STATION_COORDS.latitude,
    longitude: STATION_COORDS.longitude,
  });
}

describe('Normal users can report station status', () => {
  it('accepts a queue-only report from a plain USER', async () => {
    const station = await stationAt();
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7' });

    expect(response.status).toBe(201);
    expect(response.body.data.reportIds.queue).toBeTruthy();

    const stored = await prisma.queueReport.findMany({ where: { stationId: station.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].queueMin).toBe(4);
    expect(stored[0].queueMax).toBe(7);
    expect(stored[0].userId).toBe(user.user.id);
  });

  it('accepts an availability-only report', async () => {
    const station = await stationAt();
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ availability: Availability.LOW_SUPPLY });

    expect(response.status).toBe(201);

    const stored = await prisma.availabilityReport.findMany({
      where: { stationId: station.id },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].availability).toBe(Availability.LOW_SUPPLY);
    // Partial reporting: no queue was claimed, so no queue row exists.
    expect(await prisma.queueReport.count()).toBe(0);
  });

  it('accepts queue and availability together', async () => {
    const station = await stationAt();
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '8-15', availability: Availability.AVAILABLE });

    expect(response.status).toBe(201);
    expect(response.body.data.reportIds.queue).toBeTruthy();
    expect(response.body.data.reportIds.availability).toBeTruthy();

    expect(await prisma.queueReport.count()).toBe(1);
    expect(await prisma.availabilityReport.count()).toBe(1);
  });

  it('accepts an optional pressure reading alongside a queue', async () => {
    const station = await stationAt();
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '0-3', availability: Availability.AVAILABLE, pressureValue: 205 });

    expect(response.status).toBe(201);

    const pressure = await prisma.pressureReport.findMany({
      where: { stationId: station.id },
    });
    expect(pressure).toHaveLength(1);
    expect(pressure[0].pressureValue).toBe(205);
    // A normal user reporting pressure is explicitly allowed.
    expect(pressure[0].userId).toBe(user.user.id);
  });

  it('does not require an operator assignment', async () => {
    const station = await stationAt();
    const user = await createAndLogin({ role: UserRole.USER });

    const assignments = await prisma.stationOperator.count({
      where: { userId: user.user.id },
    });
    expect(assignments).toBe(0);

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7' });

    expect(response.status).toBe(201);
  });

  it('requires authentication', async () => {
    const station = await stationAt();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .send({ queueRange: '4-7' });

    expect(response.status).toBe(401);
  });

  it('rejects a report with nothing in it', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({});

    expect(response.status).toBe(422);
  });
});

describe('UNKNOWN is preserved, never converted to zero', () => {
  it('stores an UNKNOWN queue as null bounds', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      // "Not sure about the queue, but there is gas."
      .send({ queueRange: 'UNKNOWN', availability: Availability.AVAILABLE });

    expect(response.status).toBe(201);

    // No queue row is written at all, rather than a row claiming zero.
    const queueReports = await prisma.queueReport.findMany();
    expect(queueReports).toHaveLength(0);

    const status = await prisma.stationStatus.findUnique({
      where: { stationId: station.id },
    });
    expect(status?.queueMin).toBeNull();
    expect(status?.queueMax).toBeNull();
    expect(status?.queueMin).not.toBe(0);
    expect(status?.queueBucket).toBe('UNKNOWN');
  });

  it('keeps the wait unknown when the queue is unknown', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: 'UNKNOWN', availability: Availability.AVAILABLE });

    const status = await prisma.stationStatus.findUnique({
      where: { stationId: station.id },
    });

    expect(status?.waitMin).toBeNull();
    expect(status?.waitMax).toBeNull();
  });

  it('rejects a report where everything is UNKNOWN', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: 'UNKNOWN', availability: Availability.UNKNOWN });

    // Carries no information, so there is nothing to record.
    expect(response.status).toBe(400);
  });

  it('distinguishes a genuine zero queue from an unknown one', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '0-3' });

    const report = await prisma.queueReport.findFirst();
    expect(report?.queueMin).toBe(0);
    expect(report?.queueMax).toBe(3);
    expect(report?.queueBucket).toBe('RANGE_0_3');
  });
});

describe('Location verification is performed by the backend', () => {
  it('marks a nearby reporter as VERIFIED_NEARBY_USER', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7', ...NEARBY_COORDS });

    expect(response.status).toBe(201);
    expect(response.body.data.locationVerified).toBe(true);
    expect(response.body.data.source).toBe(ReportSource.VERIFIED_NEARBY_USER);

    const stored = await prisma.queueReport.findFirst();
    expect(stored?.source).toBe(ReportSource.VERIFIED_NEARBY_USER);
    expect(stored?.locationVerified).toBe(true);
    expect(stored?.distanceToStationM).toBeLessThan(200);
  });

  it('leaves a remote reporter as NORMAL_USER', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7', ...REMOTE_COORDS });

    expect(response.status).toBe(201);
    expect(response.body.data.locationVerified).toBe(false);
    expect(response.body.data.source).toBe(ReportSource.NORMAL_USER);

    const stored = await prisma.queueReport.findFirst();
    expect(stored?.source).toBe(ReportSource.NORMAL_USER);
    expect(stored?.locationVerified).toBe(false);
    // The report is still kept — it is just weighted lower.
    expect(stored?.distanceToStationM).toBeGreaterThan(200);
  });

  it('CANNOT be bypassed by a client-supplied locationVerified flag', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({
        queueRange: '4-7',
        ...REMOTE_COORDS,
        // A malicious client claiming to be verified.
        locationVerified: true,
      });

    // The schema is strict, so the forged field is rejected outright.
    expect(response.status).toBe(422);
    expect(await prisma.queueReport.count()).toBe(0);
  });

  it('cannot be bypassed by a forged source either', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7', ...REMOTE_COORDS, source: ReportSource.OPERATOR });

    expect(response.status).toBe(422);
  });

  it('cannot be faked by lying about coordinates far from the real ones', async () => {
    // A client CAN send false coordinates; what it cannot do is have them
    // accepted without the distance check. Claiming to be at the station while
    // actually being elsewhere is a GPS-spoofing problem, not an API one — the
    // backend's job is to verify the claim it was given, which it does.
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7', latitude: 0, longitude: 0 });

    expect(response.body.data.source).toBe(ReportSource.NORMAL_USER);
    expect(response.body.data.locationVerified).toBe(false);
  });

  it('stores an unverified report when no location is supplied', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7' });

    expect(response.status).toBe(201);
    expect(response.body.data.locationVerified).toBe(false);
    expect(response.body.data.source).toBe(ReportSource.NORMAL_USER);
    expect(response.body.data.distanceToStationM).toBeNull();
  });

  it('requires latitude and longitude together', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7', latitude: STATION_COORDS.latitude });

    expect(response.status).toBe(422);
  });

  it('weights a verified report above a remote one', async () => {
    const station = await stationAt();
    const remote = await createAndLogin();
    const nearby = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...remote.authHeader)
      .send({ availability: Availability.UNAVAILABLE, ...REMOTE_COORDS });

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...nearby.authHeader)
      .send({ availability: Availability.AVAILABLE, ...NEARBY_COORDS });

    const status = await prisma.stationStatus.findUnique({
      where: { stationId: station.id },
    });

    // The person who can actually see the forecourt wins.
    expect(status?.availability).toBe(Availability.AVAILABLE);
  });
});

describe('Report throttling', () => {
  it('blocks a rapid second report for the same station', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const first = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7' });
    expect(first.status).toBe(201);

    const second = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '8-15' });

    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('REPORT_COOLDOWN');
  });

  it('stops a user submitting a burst of updates', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const ranges = ['0-3', '4-7', '8-15', '16-25', '25+'];
    const statuses: number[] = [];

    for (const queueRange of ranges) {
      const response = await api()
        .post(`/api/v1/stations/${station.id}/reports`)
        .set(...user.authHeader)
        .send({ queueRange });
      statuses.push(response.status);
    }

    // Exactly one gets through; the rest are refused.
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(4);
    expect(await prisma.queueReport.count()).toBe(1);
  });

  it('rejects an identical duplicate report', async () => {
    const station = await stationAt();
    const otherStation = await createStation({ latitude: 23.05, longitude: 72.59 });
    const user = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7' });

    // Age the report past the per-station cooldown but keep it inside the
    // duplicate window, so the duplicate check is what fires.
    await prisma.queueReport.updateMany({
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });

    // Satisfy the global cooldown via an unrelated station.
    await api()
      .post(`/api/v1/stations/${otherStation.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '0-3' });
    await prisma.queueReport.updateMany({
      where: { stationId: otherStation.id },
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });

    const duplicate = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_REPORT');
  });

  it('allows a genuinely changed report after the cooldown', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7' });

    await prisma.queueReport.updateMany({
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });

    const changed = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '16-25' });

    expect(changed.status).toBe(201);
    expect(await prisma.queueReport.count()).toBe(2);
  });

  it('throttles per user, not globally', async () => {
    const station = await stationAt();
    const first = await createAndLogin();
    const second = await createAndLogin();

    const a = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...first.authHeader)
      .send({ queueRange: '4-7' });

    const b = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...second.authHeader)
      .send({ queueRange: '8-15' });

    // A second person reporting the same station is exactly what we want.
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });
});

describe('Raw report history is never rewritten', () => {
  it('appends rather than overwrites across many reports', async () => {
    const station = await stationAt();
    const reporters = await Promise.all([
      createAndLogin(),
      createAndLogin(),
      createAndLogin(),
    ]);

    const ranges = ['0-3', '8-15', '16-25'];
    for (const [index, reporter] of reporters.entries()) {
      await api()
        .post(`/api/v1/stations/${station.id}/reports`)
        .set(...reporter.authHeader)
        .send({ queueRange: ranges[index], availability: Availability.AVAILABLE });
    }

    const queueReports = await prisma.queueReport.findMany({
      where: { stationId: station.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(queueReports).toHaveLength(3);
    expect(queueReports.map((r) => r.queueBucket)).toEqual([
      'RANGE_0_3',
      'RANGE_8_15',
      'RANGE_16_25',
    ]);

    // Exactly one computed row, alongside all three raw rows.
    expect(await prisma.stationStatus.count({ where: { stationId: station.id } })).toBe(1);
  });

  it('keeps history intact when the status changes', async () => {
    const station = await stationAt();
    const first = await createAndLogin();
    const second = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...first.authHeader)
      .send({ availability: Availability.AVAILABLE });

    const historyAfterFirst = await prisma.availabilityReport.findMany();
    expect(historyAfterFirst).toHaveLength(1);

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...second.authHeader)
      .send({ availability: Availability.UNAVAILABLE });

    const historyAfterSecond = await prisma.availabilityReport.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // The original report still exists, unchanged.
    expect(historyAfterSecond).toHaveLength(2);
    expect(historyAfterSecond[0].id).toBe(historyAfterFirst[0].id);
    expect(historyAfterSecond[0].availability).toBe(Availability.AVAILABLE);
  });

  it('exposes the raw history through the API', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ queueRange: '4-7', availability: Availability.AVAILABLE, pressureValue: 190 });

    const response = await api().get(`/api/v1/stations/${station.id}/reports`);

    expect(response.status).toBe(200);
    expect(response.body.data.reports.queue).toHaveLength(1);
    expect(response.body.data.reports.availability).toHaveLength(1);
    expect(response.body.data.reports.pressure).toHaveLength(1);
  });
});
