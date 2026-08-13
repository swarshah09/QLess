import { createServer, type Server as HttpServer } from 'node:http';
import {
  Availability,
  Freshness,
  PressureStatus,
  PressureUnit,
  QueueBucket,
  type StationStatus,
  VisitOutcome,
} from '@prisma/client';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { recommendationService } from '../src/services/recommendation.service';
import { stationDiscoveryService, type StationView } from '../src/services/stationDiscovery.service';
import { stationStateService } from '../src/services/stationState.service';
import { SOCKET_EVENTS } from '../src/sockets/events';
import {
  createRealtimeGateway,
  noopGateway,
  setRealtimeGateway,
  type RealtimeGateway,
} from '../src/sockets/realtime.gateway';
import {
  api,
  createAndLogin,
  createStation,
  disconnect,
  resetDatabase,
} from './helpers';

beforeEach(resetDatabase);
afterAll(disconnect);

const ORIGIN = { latitude: 23.0225, longitude: 72.5714 };

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
    pressureStatus: PressureStatus.NORMAL,
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

// ---------------------------------------------------------------------------
// 1. Socket emission
// ---------------------------------------------------------------------------

describe('Socket.IO realtime', () => {
  let httpServer: HttpServer;
  let gateway: RealtimeGateway;
  let client: ClientSocket;
  let port: number;

  beforeEach(async () => {
    httpServer = createServer();
    gateway = createRealtimeGateway(httpServer);
    setRealtimeGateway(gateway);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    client?.disconnect();
    setRealtimeGateway(noopGateway);
    await gateway.close();

    // Socket.IO can leave keep-alive sockets open past close(), which holds the
    // ephemeral port. A later supertest server binding that recycled port would
    // then receive requests meant for this one and answer 404. Force the
    // connections shut so the port is released deterministically.
    httpServer.closeAllConnections?.();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function connect(): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        reconnection: false,
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  function nextEvent<T>(socket: ClientSocket, event: string, timeoutMs = 4000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  it('emits station:updated to subscribers of that station', async () => {
    const station = await createStation();
    client = await connect();

    client.emit(SOCKET_EVENTS.SUBSCRIBE_STATION, station.id);
    await nextEvent(client, SOCKET_EVENTS.SUBSCRIPTION_ACK);

    const received = nextEvent<Record<string, unknown>>(client, SOCKET_EVENTS.STATION_UPDATED);

    const status = await setStatus(station.id);
    gateway.emitStationUpdated(status);

    const payload = await received;

    expect(payload.stationId).toBe(station.id);
    expect(payload.availability).toBe(Availability.AVAILABLE);
    expect(payload.queueMin).toBe(0);
    expect(payload.queueMax).toBe(3);
    expect(payload.waitMin).toBe(5);
    expect(payload.waitMax).toBe(10);
    expect(payload.pressureValue).toBe(210);
    expect(payload.pressureStatus).toBe(PressureStatus.NORMAL);
    expect(payload.confidence).toBe(90);
    expect(payload.freshness).toBe(Freshness.LIVE);
    expect(payload.computedAt).toBeTypeOf('string');
  });

  it('emits automatically after a status recomputation', async () => {
    const station = await createStation();
    const reporter = await createAndLogin();

    client = await connect();
    client.emit(SOCKET_EVENTS.SUBSCRIBE_STATION, station.id);
    await nextEvent(client, SOCKET_EVENTS.SUBSCRIPTION_ACK);

    const received = nextEvent<{ stationId: string }>(client, SOCKET_EVENTS.STATION_UPDATED);

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...reporter.authHeader)
      .send({ queueRange: '4-7', availability: Availability.AVAILABLE });

    expect((await received).stationId).toBe(station.id);
  });

  it('does not deliver another station’s updates', async () => {
    const watched = await createStation();
    const other = await createStation();

    client = await connect();
    client.emit(SOCKET_EVENTS.SUBSCRIBE_STATION, watched.id);
    await nextEvent(client, SOCKET_EVENTS.SUBSCRIPTION_ACK);

    let leaked = false;
    client.on(SOCKET_EVENTS.STATION_UPDATED, () => {
      leaked = true;
    });

    gateway.emitStationUpdated(await setStatus(other.id));
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(leaked).toBe(false);
    expect(gateway.roomSize(other.id)).toBe(0);
    expect(gateway.roomSize(watched.id)).toBe(1);
  });

  it('stops delivering after unsubscribe', async () => {
    const station = await createStation();
    client = await connect();

    client.emit(SOCKET_EVENTS.SUBSCRIBE_STATION, station.id);
    await nextEvent(client, SOCKET_EVENTS.SUBSCRIPTION_ACK);

    client.emit(SOCKET_EVENTS.UNSUBSCRIBE_STATION, station.id);
    await nextEvent(client, SOCKET_EVENTS.SUBSCRIPTION_ACK);

    expect(gateway.roomSize(station.id)).toBe(0);
  });

  it('connects without authentication, since station data is public', async () => {
    client = await connect();
    expect(client.connected).toBe(true);
  });

  it('rejects a malformed stationId', async () => {
    client = await connect();
    const error = nextEvent<{ message: string }>(client, SOCKET_EVENTS.ERROR);
    client.emit(SOCKET_EVENTS.SUBSCRIBE_STATION, 'not-a-uuid');
    expect((await error).message).toContain('stationId');
  });
});

// ---------------------------------------------------------------------------
// 2. "I'm Here" visits
// ---------------------------------------------------------------------------

describe('Station visits ("I\'m Here")', () => {
  const STATION_COORDS = { latitude: 23.03, longitude: 72.57 };
  /** ~50 m away — inside the 200 m geofence. */
  const NEARBY = { latitude: 23.03045, longitude: 72.57015 };
  /** ~5.5 km away. */
  const REMOTE = { latitude: 23.08, longitude: 72.57 };

  async function stationAt() {
    return createStation({
      latitude: STATION_COORDS.latitude,
      longitude: STATION_COORDS.longitude,
    });
  }

  it('records a visit when the user is at the station', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/visits`)
      .set(...user.authHeader)
      .send(NEARBY);

    expect(response.status).toBe(201);
    expect(response.body.data.locationVerified).toBe(true);
    expect(response.body.data.distanceToStationM).toBeLessThan(200);

    const stored = await prisma.stationVisit.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].locationVerified).toBe(true);
    expect(stored[0].arrivedAt).not.toBeNull();
    // Arriving says nothing about the outcome.
    expect(stored[0].outcome).toBe(VisitOutcome.UNKNOWN);
  });

  it('rejects a check-in from far away', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/visits`)
      .set(...user.authHeader)
      .send(REMOTE);

    expect(response.status).toBe(422);
    expect(await prisma.stationVisit.count()).toBe(0);
  });

  it('cannot be bypassed by a client-supplied verification flag', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/visits`)
      .set(...user.authHeader)
      .send({ ...REMOTE, locationVerified: true });

    expect(response.status).toBe(422);
    expect(await prisma.stationVisit.count()).toBe(0);
  });

  it('requires authentication and coordinates', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    expect(
      (await api().post(`/api/v1/stations/${station.id}/visits`).send(NEARBY)).status,
    ).toBe(401);

    expect(
      (
        await api()
          .post(`/api/v1/stations/${station.id}/visits`)
          .set(...user.authHeader)
          .send({})
      ).status,
    ).toBe(422);
  });

  it('reuses an open visit instead of creating duplicates', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const first = await api()
      .post(`/api/v1/stations/${station.id}/visits`)
      .set(...user.authHeader)
      .send(NEARBY);
    const second = await api()
      .post(`/api/v1/stations/${station.id}/visits`)
      .set(...user.authHeader)
      .send(NEARBY);

    expect(second.body.data.visit.id).toBe(first.body.data.visit.id);
    expect(await prisma.stationVisit.count()).toBe(1);
  });

  it('tracks joinedQueue and completion', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const checkIn = await api()
      .post(`/api/v1/stations/${station.id}/visits`)
      .set(...user.authHeader)
      .send(NEARBY);
    const visitId = checkIn.body.data.visit.id;

    const joined = await api()
      .patch(`/api/v1/stations/${station.id}/visits/${visitId}/join-queue`)
      .set(...user.authHeader);
    expect(joined.status).toBe(200);
    expect(joined.body.data.visit.joinedQueueAt).not.toBeNull();

    const completed = await api()
      .patch(`/api/v1/stations/${station.id}/visits/${visitId}/complete`)
      .set(...user.authHeader)
      .send({ outcome: VisitOutcome.REFUELLED });

    expect(completed.status).toBe(200);
    expect(completed.body.data.visit.outcome).toBe(VisitOutcome.REFUELLED);
    expect(completed.body.data.visit.observedWaitMinutes).not.toBeNull();
  });

  it('NEVER assumes leaving the station means a successful refuel', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const checkIn = await api()
      .post(`/api/v1/stations/${station.id}/visits`)
      .set(...user.authHeader)
      .send(NEARBY);
    const visitId = checkIn.body.data.visit.id;

    await api()
      .patch(`/api/v1/stations/${station.id}/visits/${visitId}/join-queue`)
      .set(...user.authHeader);

    // Completing without stating an outcome.
    const completed = await api()
      .patch(`/api/v1/stations/${station.id}/visits/${visitId}/complete`)
      .set(...user.authHeader)
      .send({});

    expect(completed.body.data.visit.completedAt).not.toBeNull();
    expect(completed.body.data.visit.outcome).toBe(VisitOutcome.UNKNOWN);
    // No wait is recorded: time spent before giving up is not a service time.
    expect(completed.body.data.visit.observedWaitMinutes).toBeNull();
  });

  it('does not record an observed wait for an abandoned queue', async () => {
    const station = await stationAt();
    const user = await createAndLogin();

    const checkIn = await api()
      .post(`/api/v1/stations/${station.id}/visits`)
      .set(...user.authHeader)
      .send(NEARBY);
    const visitId = checkIn.body.data.visit.id;

    await api()
      .patch(`/api/v1/stations/${station.id}/visits/${visitId}/join-queue`)
      .set(...user.authHeader);

    const completed = await api()
      .patch(`/api/v1/stations/${station.id}/visits/${visitId}/complete`)
      .set(...user.authHeader)
      .send({ outcome: VisitOutcome.ABANDONED_QUEUE });

    expect(completed.body.data.visit.observedWaitMinutes).toBeNull();
  });

  it('does not expose another user’s visit', async () => {
    const station = await stationAt();
    const owner = await createAndLogin();
    const other = await createAndLogin();

    const checkIn = await api()
      .post(`/api/v1/stations/${station.id}/visits`)
      .set(...owner.authHeader)
      .send(NEARBY);

    const attempt = await api()
      .patch(
        `/api/v1/stations/${station.id}/visits/${checkIn.body.data.visit.id}/join-queue`,
      )
      .set(...other.authHeader);

    expect(attempt.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 3. Recommendation
// ---------------------------------------------------------------------------

/** Minimal StationView for unit-level recommendation tests. */
function view(overrides: Partial<StationView> & { id: string }): StationView {
  return {
    id: overrides.id,
    name: overrides.name ?? `Station ${overrides.id}`,
    address: 'Somewhere',
    city: null,
    state: null,
    pincode: null,
    latitude: 23,
    longitude: 72,
    active: overrides.active ?? true,
    numberOfDispensers: 4,
    operatingHours: null,
    distanceKm: overrides.distanceKm ?? null,
    distanceM: overrides.distanceM ?? null,
    saved: false,
    status: {
      availability: Availability.AVAILABLE,
      queue: { min: 0, max: 3, bucket: 'RANGE_0_3', label: '0-3' },
      wait: { min: 5, max: 10 },
      pressure: {
        value: 210,
        unit: 'BAR',
        status: 'NORMAL',
        thresholds: { low: null, normal: null },
      },
      activeDispensers: 4,
      confidence: 90,
      freshness: Freshness.LIVE,
      computedAt: new Date(),
      lastOperatorUpdateAt: new Date(),
      lastUserUpdateAt: null,
      ...overrides.status,
    },
  };
}

describe('RecommendationService', () => {
  it('never recommends an UNAVAILABLE station', () => {
    const result = recommendationService.recommend([
      view({
        id: 'a',
        distanceM: 500,
        status: { availability: Availability.UNAVAILABLE } as never,
      }),
      view({ id: 'b', distanceM: 6000 }),
    ]);

    expect(result.recommendedStationId).toBe('b');
    expect(result.scores.find((s) => s.stationId === 'a')?.eligible).toBe(false);
  });

  it('recommends nothing when no station is trustworthy', () => {
    const result = recommendationService.recommend([
      view({
        id: 'a',
        distanceM: 500,
        status: { availability: Availability.UNAVAILABLE } as never,
      }),
      view({
        id: 'b',
        distanceM: 900,
        status: { availability: Availability.UNKNOWN } as never,
      }),
    ]);

    expect(result.recommendedStationId).toBeNull();
    expect(result.reason).toContain('reliable');
  });

  it('excludes stale and low-confidence stations from being the best choice', () => {
    const stale = recommendationService.recommend([
      view({ id: 'a', distanceM: 500, status: { freshness: Freshness.STALE } as never }),
    ]);
    expect(stale.recommendedStationId).toBeNull();

    const unsure = recommendationService.recommend([
      view({ id: 'a', distanceM: 500, status: { confidence: 20 } as never }),
    ]);
    expect(unsure.recommendedStationId).toBeNull();
  });

  it('prefers the nearest when the saving is not meaningful', () => {
    const result = recommendationService.recommend([
      view({ id: 'near', distanceM: 1000, status: { wait: { min: 8, max: 12 } } as never }),
      view({ id: 'far', distanceM: 2500, status: { wait: { min: 4, max: 8 } } as never }),
    ]);

    expect(result.recommendedStationId).toBe('near');
    expect(result.differsFromNearest).toBe(false);
  });

  it('recommends a farther station when it meaningfully saves time', () => {
    const result = recommendationService.recommend([
      view({ id: 'near', distanceM: 800, status: { wait: { min: 40, max: 55 } } as never }),
      view({ id: 'far', distanceM: 4000, status: { wait: { min: 3, max: 6 } } as never }),
    ]);

    expect(result.recommendedStationId).toBe('far');
    expect(result.differsFromNearest).toBe(true);
    expect(result.savingMinutes!).toBeGreaterThanOrEqual(8);
    expect(result.reason).toContain('save');
  });

  it('surfaces alternatives with an approximate time saving', () => {
    const result = recommendationService.recommend([
      view({ id: 'near', distanceM: 800, status: { wait: { min: 40, max: 55 } } as never }),
      view({ id: 'mid', distanceM: 2000, status: { wait: { min: 10, max: 18 } } as never }),
      view({ id: 'far', distanceM: 4000, status: { wait: { min: 3, max: 6 } } as never }),
    ]);

    expect(result.alternatives.length).toBeGreaterThan(0);
    for (const alternative of result.alternatives) {
      expect(alternative).toHaveProperty('savingMinutes');
      expect(alternative.stationId).not.toBe(result.recommendedStationId);
    }
  });

  it('penalises an unknown queue rather than treating it as fast', () => {
    const result = recommendationService.recommend([
      view({
        id: 'unknown',
        distanceM: 1000,
        status: {
          queue: { min: null, max: null, bucket: 'UNKNOWN', label: 'Unknown' },
          wait: { min: null, max: null },
        } as never,
      }),
    ]);

    const score = result.scores[0];
    expect(score.penaltyMinutes).toBeGreaterThan(0);
    expect(score.waitMinutes).toBeNull();
  });

  it('does not reorder the list it is given', () => {
    const stations = [
      view({ id: 'near', distanceM: 800, status: { wait: { min: 40, max: 55 } } as never }),
      view({ id: 'far', distanceM: 4000, status: { wait: { min: 3, max: 6 } } as never }),
    ];
    const before = stations.map((s) => s.id);

    recommendationService.recommend(stations);

    expect(stations.map((s) => s.id)).toEqual(before);
  });
});

describe('Recommendation endpoint keeps nearest-first ordering', () => {
  it('returns stations nearest-first while recommending a farther one', async () => {
    // Nearest but heavily congested; farther but empty.
    const near = await createStation({ latitude: 23.0295, longitude: 72.5714 });
    const far = await createStation({ latitude: 23.0625, longitude: 72.5714 });

    await setStatus(near.id, {
      queueMin: 16,
      queueMax: 25,
      queueBucket: QueueBucket.RANGE_16_25,
      waitMin: 45,
      waitMax: 60,
    });
    await setStatus(far.id, {
      queueMin: 0,
      queueMax: 3,
      queueBucket: QueueBucket.RANGE_0_3,
      waitMin: 2,
      waitMax: 5,
    });

    const response = await api().get(
      `/api/v1/stations/recommendations?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000`,
    );

    expect(response.status).toBe(200);

    const ids = response.body.data.stations.map((s: { id: string }) => s.id);
    // The list itself is untouched: nearest first, always.
    expect(ids).toEqual([near.id, far.id]);

    const recommendation = response.body.data.recommendation;
    expect(recommendation.nearestStationId).toBe(near.id);
    expect(recommendation.recommendedStationId).toBe(far.id);
    expect(recommendation.differsFromNearest).toBe(true);
    expect(recommendation.savingMinutes).toBeGreaterThan(0);
  });

  it('leaves /nearby ordering unchanged', async () => {
    const near = await createStation({ latitude: 23.0295, longitude: 72.5714 });
    const far = await createStation({ latitude: 23.0625, longitude: 72.5714 });

    await setStatus(near.id, { waitMin: 45, waitMax: 60 });
    await setStatus(far.id, { waitMin: 2, waitMax: 5 });

    const response = await api().get(
      `/api/v1/stations/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000`,
    );

    const ids = response.body.data.stations.map((s: { id: string }) => s.id);
    expect(ids).toEqual([near.id, far.id]);
  });

  it('does not recommend an unavailable nearest station', async () => {
    const near = await createStation({ latitude: 23.0295, longitude: 72.5714 });
    const far = await createStation({ latitude: 23.0425, longitude: 72.5714 });

    await setStatus(near.id, { availability: Availability.UNAVAILABLE });
    await setStatus(far.id, { availability: Availability.AVAILABLE });

    const response = await api().get(
      `/api/v1/stations/recommendations?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radius=20000`,
    );

    const recommendation = response.body.data.recommendation;
    expect(recommendation.nearestStationId).toBe(near.id);
    expect(recommendation.recommendedStationId).toBe(far.id);
  });

  it('labels its travel estimate as approximate', async () => {
    await createStation({ latitude: 23.0295, longitude: 72.5714 });

    const response = await api().get(
      `/api/v1/stations/recommendations?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}`,
    );

    expect(response.body.data.travelAssumptions.approximate).toBe(true);
    expect(response.body.data.travelAssumptions.note).toContain('not a routed ETA');
  });

  it('works for guests', async () => {
    await createStation({ latitude: 23.0295, longitude: 72.5714 });
    const response = await api().get(
      `/api/v1/stations/recommendations?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}`,
    );
    expect(response.status).toBe(200);
  });
});

describe('Discovery ordering is unaffected by Part 6', () => {
  it('still sorts nearest-first through the service', async () => {
    const far = await createStation({ latitude: 23.0625, longitude: 72.5714 });
    const near = await createStation({ latitude: 23.0295, longitude: 72.5714 });
    await stationStateService.recompute(near.id, { emitRealtime: false });
    await stationStateService.recompute(far.id, { emitRealtime: false });

    const stations = await stationDiscoveryService.nearby({
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      radiusM: 20_000,
      limit: 10,
      filters: {},
    });

    expect(stations.map((s) => s.id)).toEqual([near.id, far.id]);
  });
});
