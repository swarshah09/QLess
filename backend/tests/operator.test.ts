import {
  Availability,
  PressureStatus,
  ReportSource,
  StationOperatorRole,
  SupplyEventType,
  UserRole,
} from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import {
  api,
  assignOperator,
  createAndLogin,
  createStation,
  disconnect,
  resetDatabase,
} from './helpers';

beforeEach(resetDatabase);
afterAll(disconnect);

describe('Operator status updates', () => {
  it('lets an operator update their assigned station', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id, StationOperatorRole.MANAGER);

    const response = await api()
      .post(`/api/v1/stations/${station.id}/operator-update`)
      .set(...operator.authHeader)
      .send({
        queueRange: '4-7',
        availability: Availability.AVAILABLE,
        pressureValue: 210,
        activeDispensers: 3,
      });

    expect(response.status).toBe(201);
    expect(response.body.data.status.availability).toBe(Availability.AVAILABLE);
    expect(response.body.data.status.activeDispensers).toBe(3);
  });

  it('returns 403 for an unassigned station', async () => {
    const assigned = await createStation({ name: 'Assigned' });
    const other = await createStation({ name: 'Other' });
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, assigned.id);

    const response = await api()
      .post(`/api/v1/stations/${other.id}/operator-update`)
      .set(...operator.authHeader)
      .send({ availability: Availability.UNAVAILABLE });

    expect(response.status).toBe(403);
    // Nothing was written for the station they had no rights to.
    expect(await prisma.availabilityReport.count({ where: { stationId: other.id } })).toBe(0);
  });

  it('returns 403 when a plain USER calls the operator route', async () => {
    const station = await createStation();
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api()
      .post(`/api/v1/stations/${station.id}/operator-update`)
      .set(...user.authHeader)
      .send({ availability: Availability.AVAILABLE });

    expect(response.status).toBe(403);
  });

  it('tags operator updates with source OPERATOR', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    await api()
      .post(`/api/v1/stations/${station.id}/operator-update`)
      .set(...operator.authHeader)
      .send({ queueRange: '8-15', availability: Availability.LOW_SUPPLY, pressureValue: 150 });

    const [queue, availability, pressure] = await Promise.all([
      prisma.queueReport.findFirst(),
      prisma.availabilityReport.findFirst(),
      prisma.pressureReport.findFirst(),
    ]);

    expect(queue?.source).toBe(ReportSource.OPERATOR);
    expect(availability?.source).toBe(ReportSource.OPERATOR);
    expect(pressure?.source).toBe(ReportSource.OPERATOR);
  });

  it('creates historical rows rather than writing status directly', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    await api()
      .post(`/api/v1/stations/${station.id}/operator-update`)
      .set(...operator.authHeader)
      .send({ queueRange: '0-3', availability: Availability.AVAILABLE });

    // The update left a permanent trace, not just a mutated projection.
    expect(await prisma.queueReport.count()).toBe(1);
    expect(await prisma.availabilityReport.count()).toBe(1);

    await api()
      .post(`/api/v1/stations/${station.id}/operator-update`)
      .set(...operator.authHeader)
      .send({ queueRange: '16-25', availability: Availability.LOW_SUPPLY });

    expect(await prisma.queueReport.count()).toBe(2);
    expect(await prisma.availabilityReport.count()).toBe(2);
    expect(await prisma.stationStatus.count()).toBe(1);
  });

  it('outweighs a normal user report', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    const user = await createAndLogin({ role: UserRole.USER });
    await assignOperator(operator.user.id, station.id);

    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ availability: Availability.UNAVAILABLE });

    await api()
      .post(`/api/v1/stations/${station.id}/operator-update`)
      .set(...operator.authHeader)
      .send({ availability: Availability.AVAILABLE });

    const status = await prisma.stationStatus.findUnique({
      where: { stationId: station.id },
    });

    expect(status?.availability).toBe(Availability.AVAILABLE);
    expect(status?.lastOperatorUpdateAt).not.toBeNull();
    expect(status?.lastUserUpdateAt).not.toBeNull();
  });

  it('is not subject to the user report cooldown', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    const first = await api()
      .post(`/api/v1/stations/${station.id}/operator-update`)
      .set(...operator.authHeader)
      .send({ queueRange: '0-3' });

    const second = await api()
      .post(`/api/v1/stations/${station.id}/operator-update`)
      .set(...operator.authHeader)
      .send({ queueRange: '16-25' });

    // A busy forecourt changes fast; operators must be able to keep up.
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it('rejects more active dispensers than the station has', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    const response = await api()
      .post(`/api/v1/stations/${station.id}/operator-update`)
      .set(...operator.authHeader)
      .send({ activeDispensers: 99 });

    expect(response.status).toBe(422);
  });

  it('keeps the wait unknown when no dispensers are serving', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    await api()
      .post(`/api/v1/stations/${station.id}/operator-update`)
      .set(...operator.authHeader)
      .send({
        queueRange: '8-15',
        availability: Availability.TEMPORARILY_INTERRUPTED,
        activeDispensers: 0,
      });

    const status = await prisma.stationStatus.findUnique({
      where: { stationId: station.id },
    });

    // Nothing is being served, so how long the queue will take is unknowable.
    expect(status?.waitMin).toBeNull();
    expect(status?.waitMax).toBeNull();
  });
});

describe('Pressure uses per-station thresholds', () => {
  it('classifies the same reading differently for two stations', async () => {
    const strict = await createStation({ name: 'High Spec' });
    const lenient = await createStation({ name: 'Older Kit' });

    await prisma.station.update({
      where: { id: strict.id },
      data: { pressureThresholdLow: 180, pressureThresholdNormal: 220 },
    });
    await prisma.station.update({
      where: { id: lenient.id },
      data: { pressureThresholdLow: 120, pressureThresholdNormal: 160 },
    });

    const operator = await createAndLogin({ role: UserRole.ADMIN });

    for (const station of [strict, lenient]) {
      await api()
        .post(`/api/v1/stations/${station.id}/reports`)
        .set(...operator.authHeader)
        .send({ pressureValue: 170 });
    }

    const [strictStatus, lenientStatus] = await Promise.all([
      prisma.stationStatus.findUnique({ where: { stationId: strict.id } }),
      prisma.stationStatus.findUnique({ where: { stationId: lenient.id } }),
    ]);

    // 170 bar is low for one station and perfectly normal for the other —
    // exactly why there is no universal threshold.
    expect(strictStatus?.pressureStatus).toBe(PressureStatus.LOW);
    expect(lenientStatus?.pressureStatus).toBe(PressureStatus.NORMAL);
  });

  it('normalises a PSI reading to bar', async () => {
    const station = await createStation();
    const reporter = await createAndLogin({ role: UserRole.ADMIN });

    // 2900 psi ≈ 200 bar.
    await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...reporter.authHeader)
      .send({ pressureValue: 2900, pressureUnit: 'PSI' });

    const stored = await prisma.pressureReport.findFirst();
    expect(stored?.pressureValue).toBe(2900);
    expect(stored?.pressureUnit).toBe('PSI');

    const status = await prisma.stationStatus.findUnique({
      where: { stationId: station.id },
    });
    expect(status?.pressureUnit).toBe('BAR');
    expect(status?.pressureValue).toBeGreaterThan(190);
    expect(status?.pressureValue).toBeLessThan(210);
  });

  it('rejects an implausible pressure reading', async () => {
    const station = await createStation();
    const user = await createAndLogin();

    const response = await api()
      .post(`/api/v1/stations/${station.id}/reports`)
      .set(...user.authHeader)
      .send({ pressureValue: 9999 });

    expect(response.status).toBe(422);
  });
});

describe('Supply events', () => {
  it('stores an event with its type, timestamp and operator', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    const response = await api()
      .post(`/api/v1/stations/${station.id}/supply-events`)
      .set(...operator.authHeader)
      .send({ type: SupplyEventType.SUPPLY_ARRIVED, note: 'Tanker delivered' });

    expect(response.status).toBe(201);

    const stored = await prisma.supplyEvent.findMany({ where: { stationId: station.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].type).toBe(SupplyEventType.SUPPLY_ARRIVED);
    expect(stored[0].reportedByUserId).toBe(operator.user.id);
    expect(stored[0].startedAt).toBeInstanceOf(Date);
    expect(stored[0].source).toBe(ReportSource.OPERATOR);
  });

  it('supports all four operator-facing event types', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    const types = [
      SupplyEventType.SUPPLY_ARRIVED,
      SupplyEventType.LOW_SUPPLY,
      SupplyEventType.CNG_FINISHED,
      SupplyEventType.TEMPORARY_INTERRUPTION,
    ];

    for (const type of types) {
      const response = await api()
        .post(`/api/v1/stations/${station.id}/supply-events`)
        .set(...operator.authHeader)
        .send({ type });
      expect(response.status).toBe(201);
    }

    expect(await prisma.supplyEvent.count()).toBe(4);
  });

  it('applies the availability implied by the event type', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    await api()
      .post(`/api/v1/stations/${station.id}/supply-events`)
      .set(...operator.authHeader)
      .send({ type: SupplyEventType.CNG_FINISHED });

    const status = await prisma.stationStatus.findUnique({
      where: { stationId: station.id },
    });

    expect(status?.availability).toBe(Availability.UNAVAILABLE);
  });

  it('returns 403 for an unassigned station', async () => {
    const assigned = await createStation();
    const other = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, assigned.id);

    const response = await api()
      .post(`/api/v1/stations/${other.id}/supply-events`)
      .set(...operator.authHeader)
      .send({ type: SupplyEventType.LOW_SUPPLY });

    expect(response.status).toBe(403);
    expect(await prisma.supplyEvent.count()).toBe(0);
  });

  it('overrides accumulated user reports rather than being out-voted', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    // Several users report AVAILABLE, then the operator declares the gas gone.
    for (let i = 0; i < 3; i += 1) {
      const user = await createAndLogin({ role: UserRole.USER });
      await api()
        .post(`/api/v1/stations/${station.id}/reports`)
        .set(...user.authHeader)
        .send({ availability: Availability.AVAILABLE });
    }

    await api()
      .post(`/api/v1/stations/${station.id}/operator-update`)
      .set(...operator.authHeader)
      .send({ availability: Availability.AVAILABLE });

    await api()
      .post(`/api/v1/stations/${station.id}/supply-events`)
      .set(...operator.authHeader)
      .send({ type: SupplyEventType.CNG_FINISHED });

    const status = await prisma.stationStatus.findUnique({
      where: { stationId: station.id },
    });

    // A majority vote would still say AVAILABLE and keep sending drivers to an
    // empty station; the operator's latest word is authoritative instead.
    expect(status?.availability).toBe(Availability.UNAVAILABLE);
    // Confidence drops because the crowd has not yet corroborated it.
    expect(status?.confidence).toBeLessThan(100);
  });

  it('closes an open event without deleting it', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    const created = await api()
      .post(`/api/v1/stations/${station.id}/supply-events`)
      .set(...operator.authHeader)
      .send({ type: SupplyEventType.TEMPORARY_INTERRUPTION });

    const eventId = created.body.data.event.id;

    const closed = await api()
      .patch(`/api/v1/stations/${station.id}/supply-events/${eventId}/close`)
      .set(...operator.authHeader);

    expect(closed.status).toBe(200);

    const stored = await prisma.supplyEvent.findUnique({ where: { id: eventId } });
    expect(stored).not.toBeNull();
    expect(stored?.endedAt).not.toBeNull();
  });

  it('lists supply events publicly', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    await api()
      .post(`/api/v1/stations/${station.id}/supply-events`)
      .set(...operator.authHeader)
      .send({ type: SupplyEventType.SUPPLY_ARRIVED });

    const response = await api().get(`/api/v1/stations/${station.id}/supply-events`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
  });
});

describe('Saved stations', () => {
  it('saves, lists and unsaves', async () => {
    const station = await createStation({ name: 'Favourite' });
    const user = await createAndLogin();

    const saved = await api()
      .post(`/api/v1/stations/${station.id}/save`)
      .set(...user.authHeader)
      .send({ label: 'Near home' });
    expect(saved.status).toBe(201);

    const list = await api().get('/api/v1/stations/saved').set(...user.authHeader);
    expect(list.status).toBe(200);
    expect(list.body.data.stations).toHaveLength(1);
    expect(list.body.data.stations[0].label).toBe('Near home');
    expect(list.body.data.stations[0].station.name).toBe('Favourite');

    const removed = await api()
      .delete(`/api/v1/stations/${station.id}/save`)
      .set(...user.authHeader);
    expect(removed.status).toBe(200);

    const empty = await api().get('/api/v1/stations/saved').set(...user.authHeader);
    expect(empty.body.data.stations).toHaveLength(0);
  });

  it('is idempotent when saving twice', async () => {
    const station = await createStation();
    const user = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/save`)
      .set(...user.authHeader)
      .send({ label: 'First' });
    const second = await api()
      .post(`/api/v1/stations/${station.id}/save`)
      .set(...user.authHeader)
      .send({ label: 'Updated' });

    expect(second.status).toBe(201);
    expect(await prisma.savedStation.count()).toBe(1);

    const list = await api().get('/api/v1/stations/saved').set(...user.authHeader);
    expect(list.body.data.stations[0].label).toBe('Updated');
  });

  it('scopes saved stations to their owner', async () => {
    const station = await createStation();
    const owner = await createAndLogin();
    const other = await createAndLogin();

    await api()
      .post(`/api/v1/stations/${station.id}/save`)
      .set(...owner.authHeader)
      .send({});

    const list = await api().get('/api/v1/stations/saved').set(...other.authHeader);
    expect(list.body.data.stations).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const station = await createStation();

    expect((await api().get('/api/v1/stations/saved')).status).toBe(401);
    expect((await api().post(`/api/v1/stations/${station.id}/save`).send({})).status).toBe(401);
  });

  it('returns 404 when saving a station that does not exist', async () => {
    const user = await createAndLogin();

    const response = await api()
      .post('/api/v1/stations/00000000-0000-4000-8000-000000000000/save')
      .set(...user.authHeader)
      .send({});

    expect(response.status).toBe(404);
  });

  it('sorts saved stations nearest first when coordinates are supplied', async () => {
    const near = await createStation({ latitude: 23.0295, longitude: 72.5714 });
    const far = await createStation({ latitude: 23.0925, longitude: 72.5714 });
    const user = await createAndLogin();

    // Saved furthest-first so insertion order is the opposite of the expectation.
    await api().post(`/api/v1/stations/${far.id}/save`).set(...user.authHeader).send({});
    await api().post(`/api/v1/stations/${near.id}/save`).set(...user.authHeader).send({});

    const response = await api()
      .get('/api/v1/stations/saved?latitude=23.0225&longitude=72.5714')
      .set(...user.authHeader);

    const ids = response.body.data.stations.map(
      (row: { station: { id: string } }) => row.station.id,
    );
    expect(ids).toEqual([near.id, far.id]);
  });
});
