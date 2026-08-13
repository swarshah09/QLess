import { Availability, UserRole } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { stationStatusService } from '../src/services/stationStatus.service';
import {
  api,
  createAndLogin,
  createStation,
  disconnect,
  resetDatabase,
} from './helpers';

beforeEach(resetDatabase);
afterAll(disconnect);

/**
 * A fixed origin in Ahmedabad. Station coordinates below are chosen to sit at
 * known, clearly separated distances from it so ordering assertions are about
 * the sort, not about floating-point luck.
 */
const ORIGIN = { latitude: 23.0225, longitude: 72.5714 };

describe('GET /api/v1/stations/nearby', () => {
  it('returns stations nearest first by default', async () => {
    // Deliberately created FURTHEST first, so insertion order is the reverse of
    // the expected result and cannot accidentally produce a passing test.
    const far = await createStation({
      name: 'C Far',
      latitude: 23.0625,
      longitude: 72.5714,
    });
    const middle = await createStation({
      name: 'B Middle',
      latitude: 23.0415,
      longitude: 72.5714,
    });
    const near = await createStation({
      name: 'A Near',
      latitude: 23.0295,
      longitude: 72.5714,
    });

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000`,
    );

    expect(response.status).toBe(200);

    const ids = response.body.data.stations.map((s: { id: string }) => s.id);
    expect(ids).toEqual([near.id, middle.id, far.id]);
  });

  it('returns distance in km, ascending', async () => {
    await createStation({ name: 'Near', latitude: 23.0295, longitude: 72.5714 });
    await createStation({ name: 'Middle', latitude: 23.0415, longitude: 72.5714 });
    await createStation({ name: 'Far', latitude: 23.0625, longitude: 72.5714 });

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000`,
    );

    const distances = response.body.data.stations.map(
      (s: { distanceKm: number }) => s.distanceKm,
    );

    expect(distances).toHaveLength(3);
    for (const distance of distances) {
      expect(distance).toBeTypeOf('number');
      expect(distance).toBeGreaterThan(0);
    }
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('computes a plausible distance for a known separation', async () => {
    // ~1.11 km due north (0.01 degrees of latitude).
    await createStation({ name: 'One Km North', latitude: 23.0325, longitude: 72.5714 });

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000`,
    );

    const [station] = response.body.data.stations;
    expect(station.distanceKm).toBeGreaterThan(1.0);
    expect(station.distanceKm).toBeLessThan(1.2);
  });

  it('produces a different order from a different origin', async () => {
    const north = await createStation({
      name: 'North',
      latitude: 23.0725,
      longitude: 72.5714,
    });
    const south = await createStation({
      name: 'South',
      latitude: 22.9725,
      longitude: 72.5714,
    });

    const fromSouth = await api().get(
      '/api/v1/stations/nearby?latitude=22.9800&longitude=72.5714&radius=30000',
    );
    const fromNorth = await api().get(
      '/api/v1/stations/nearby?latitude=23.0650&longitude=72.5714&radius=30000',
    );

    expect(fromSouth.body.data.stations[0].id).toBe(south.id);
    expect(fromNorth.body.data.stations[0].id).toBe(north.id);
  });

  it('excludes stations beyond the radius', async () => {
    await createStation({ name: 'Inside', latitude: 23.0295, longitude: 72.5714 });
    await createStation({ name: 'Outside', latitude: 23.2225, longitude: 72.5714 });

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=3000`,
    );

    const names = response.body.data.stations.map((s: { name: string }) => s.name);
    expect(names).toEqual(['Inside']);
  });

  it('trims the bounding box corners to a true circle', async () => {
    // Diagonally offset: inside the lat/lng bounding box for a 5 km radius but
    // outside the actual circle, so a box-only implementation would return it.
    await createStation({ name: 'Corner', latitude: 23.0585, longitude: 72.6074 });

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=5000`,
    );

    expect(response.body.data.stations).toHaveLength(0);
  });

  it('excludes inactive stations', async () => {
    await createStation({ name: 'Open', latitude: 23.0295, longitude: 72.5714 });
    await createStation({
      name: 'Closed',
      latitude: 23.0296,
      longitude: 72.5714,
      active: false,
    });

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000`,
    );

    const names = response.body.data.stations.map((s: { name: string }) => s.name);
    expect(names).toEqual(['Open']);
  });

  it('works for guests', async () => {
    await createStation({ latitude: 23.0295, longitude: 72.5714 });

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data.stations[0].saved).toBe(false);
  });

  it('rejects a request with no coordinates', async () => {
    const response = await api().get('/api/v1/stations/nearby');
    expect(response.status).toBe(422);
  });

  it('rejects an out-of-range latitude', async () => {
    const response = await api().get(
      '/api/v1/stations/nearby?latitude=120&longitude=72.5714',
    );
    expect(response.status).toBe(422);
  });
});

describe('Nearby sorting and filtering', () => {
  /** Two stations: near with a long queue, far with a short one. */
  async function seedContrastingStations() {
    const near = await createStation({
      name: 'Near Busy',
      latitude: 23.0295,
      longitude: 72.5714,
    });
    const far = await createStation({
      name: 'Far Quiet',
      latitude: 23.0625,
      longitude: 72.5714,
    });

    const operator = await createAndLogin({ role: UserRole.ADMIN });

    await api()
      .post(`/api/v1/stations/${near.id}/reports`)
      .set(...operator.authHeader)
      .send({ queueRange: '16-25', availability: Availability.AVAILABLE });

    await api()
      .post(`/api/v1/stations/${far.id}/reports`)
      .set(...operator.authHeader)
      .send({ queueRange: '0-3', availability: Availability.AVAILABLE });

    return { near, far };
  }

  it('sorts by queue when asked', async () => {
    const { near, far } = await seedContrastingStations();

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000&sort=queue`,
    );

    const ids = response.body.data.stations.map((s: { id: string }) => s.id);
    // The quieter station wins despite being further away.
    expect(ids).toEqual([far.id, near.id]);
  });

  it('sorts by wait when asked', async () => {
    const { near, far } = await seedContrastingStations();

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000&sort=wait`,
    );

    const ids = response.body.data.stations.map((s: { id: string }) => s.id);
    expect(ids).toEqual([far.id, near.id]);
  });

  it('still defaults to distance with the same data', async () => {
    const { near, far } = await seedContrastingStations();

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000`,
    );

    const ids = response.body.data.stations.map((s: { id: string }) => s.id);
    expect(ids).toEqual([near.id, far.id]);
  });

  it('applies the limit after sorting, not before', async () => {
    const { far } = await seedContrastingStations();

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000&sort=queue&limit=1`,
    );

    // With limit applied first this would return the NEAREST station reordered;
    // the point of sort=queue&limit=1 is the shortest queue in the radius.
    expect(response.body.data.stations).toHaveLength(1);
    expect(response.body.data.stations[0].id).toBe(far.id);
  });

  it('filters by availability', async () => {
    const available = await createStation({
      name: 'Has Gas',
      latitude: 23.0295,
      longitude: 72.5714,
    });
    const unavailable = await createStation({
      name: 'No Gas',
      latitude: 23.0296,
      longitude: 72.5714,
    });

    const reporter = await createAndLogin({ role: UserRole.ADMIN });
    await api()
      .post(`/api/v1/stations/${available.id}/reports`)
      .set(...reporter.authHeader)
      .send({ availability: Availability.AVAILABLE });
    await api()
      .post(`/api/v1/stations/${unavailable.id}/reports`)
      .set(...reporter.authHeader)
      .send({ availability: Availability.UNAVAILABLE });

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000&availability=AVAILABLE`,
    );

    const ids = response.body.data.stations.map((s: { id: string }) => s.id);
    expect(ids).toEqual([available.id]);
  });

  it('filters by maximum queue', async () => {
    const { far } = await seedContrastingStations();

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000&maxQueue=5`,
    );

    const ids = response.body.data.stations.map((s: { id: string }) => s.id);
    expect(ids).toEqual([far.id]);
  });

  it('excludes unknown-queue stations from a maxQueue filter', async () => {
    // A station nobody has reported on must not pass "at most 5 in the queue" —
    // no information is not the same as a short queue.
    await createStation({ name: 'Unreported', latitude: 23.0295, longitude: 72.5714 });

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000&maxQueue=5`,
    );

    expect(response.body.data.stations).toHaveLength(0);
  });

  it('marks saved stations for a signed-in viewer', async () => {
    const station = await createStation({ latitude: 23.0295, longitude: 72.5714 });
    const user = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/save`)
      .set(...user.authHeader)
      .send({});

    const response = await api()
      .get(
        `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000`,
      )
      .set(...user.authHeader);

    expect(response.body.data.stations[0].saved).toBe(true);
  });
});

describe('GET /api/v1/stations/:stationId', () => {
  it('returns full detail for a guest', async () => {
    const station = await createStation();
    await stationStatusService.recompute(station.id);

    const response = await api().get(`/api/v1/stations/${station.id}`);

    expect(response.status).toBe(200);

    const body = response.body.data.station;
    expect(body.id).toBe(station.id);
    expect(body.status).toBeDefined();
    expect(body.status.availability).toBeDefined();
    expect(body.status.queue).toBeDefined();
    expect(body.status.wait).toBeDefined();
    expect(body.status.pressure).toBeDefined();
    expect(body.status.freshness).toBeDefined();
    expect(body.status.confidence).toBeTypeOf('number');
  });

  it('omits distance when no coordinates are supplied', async () => {
    const station = await createStation();

    const response = await api().get(`/api/v1/stations/${station.id}`);

    expect(response.body.data.station.distanceKm).toBeNull();
    expect(response.body.data.station.distanceM).toBeNull();
  });

  it('includes distance when coordinates are supplied', async () => {
    const station = await createStation({ latitude: 23.0325, longitude: 72.5714 });

    const response = await api().get(
      `/api/v1/stations/${station.id}?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}`,
    );

    expect(response.body.data.station.distanceKm).toBeGreaterThan(1.0);
    expect(response.body.data.station.distanceKm).toBeLessThan(1.2);
  });

  it('reports an unreported station as UNKNOWN, not as empty', async () => {
    const station = await createStation();

    const response = await api().get(`/api/v1/stations/${station.id}`);
    const status = response.body.data.station.status;

    expect(status.availability).toBe(Availability.UNKNOWN);
    // The critical assertion: no data must never look like "no queue".
    expect(status.queue.min).toBeNull();
    expect(status.queue.max).toBeNull();
    expect(status.queue.min).not.toBe(0);
    expect(status.confidence).toBe(0);
  });

  it('echoes the station-specific pressure thresholds', async () => {
    const station = await createStation();
    await prisma.station.update({
      where: { id: station.id },
      data: { pressureThresholdLow: 140, pressureThresholdNormal: 190 },
    });

    const response = await api().get(`/api/v1/stations/${station.id}`);

    expect(response.body.data.station.status.pressure.thresholds).toEqual({
      low: 140,
      normal: 190,
    });
  });

  it('returns 404 for an unknown station', async () => {
    const response = await api().get(
      '/api/v1/stations/00000000-0000-4000-8000-000000000000',
    );
    expect(response.status).toBe(404);
  });

  it('rejects a stray latitude without a longitude', async () => {
    const station = await createStation();

    const response = await api().get(`/api/v1/stations/${station.id}?latitude=23.02`);
    expect(response.status).toBe(422);
  });
});
