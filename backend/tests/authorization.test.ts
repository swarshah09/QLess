import { StationOperatorRole, UserRole } from '@prisma/client';
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

describe('Guest access to station discovery', () => {
  it('lists stations without authentication', async () => {
    await createStation({ name: 'Guest Visible Station' });

    const response = await api().get('/api/v1/stations');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].name).toBe('Guest Visible Station');
  });

  it('returns station details without authentication', async () => {
    const station = await createStation();

    const response = await api().get(`/api/v1/stations/${station.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.station.id).toBe(station.id);
    // Coordinates must reach guests — distance-based discovery depends on them.
    expect(response.body.data.station.latitude).toBeTypeOf('number');
    expect(response.body.data.station.longitude).toBeTypeOf('number');
  });

  it('treats an invalid token as a guest rather than erroring', async () => {
    await createStation();

    const response = await api()
      .get('/api/v1/stations')
      .set('Authorization', 'Bearer garbage-token');

    // An expired token must never break browsing for an otherwise-guest user.
    expect(response.status).toBe(200);
  });

  it('hides inactive stations from guests', async () => {
    await createStation({ name: 'Active One', active: true });
    await createStation({ name: 'Closed One', active: false });

    const response = await api().get('/api/v1/stations');

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].name).toBe('Active One');
  });

  it('lets an admin opt into seeing inactive stations', async () => {
    await createStation({ name: 'Active One', active: true });
    await createStation({ name: 'Closed One', active: false });

    const admin = await createAndLogin({ role: UserRole.ADMIN });
    const response = await api()
      .get('/api/v1/stations?includeInactive=true')
      .set(...admin.authHeader);

    expect(response.body.data.items).toHaveLength(2);
  });

  it('ignores includeInactive for a normal user', async () => {
    await createStation({ name: 'Active One', active: true });
    await createStation({ name: 'Closed One', active: false });

    const user = await createAndLogin({ role: UserRole.USER });
    const response = await api()
      .get('/api/v1/stations?includeInactive=true')
      .set(...user.authHeader);

    expect(response.body.data.items).toHaveLength(1);
  });
});

describe('Protected actions require authentication', () => {
  it('rejects an unauthenticated station update with 401', async () => {
    const station = await createStation();

    const response = await api()
      .patch(`/api/v1/stations/${station.id}`)
      .send({ numberOfDispensers: 6 });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unauthenticated admin route with 401', async () => {
    const response = await api().get('/api/v1/admin/users');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('lets an authenticated USER reach their own profile', async () => {
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api().get('/api/v1/auth/me').set(...user.authHeader);
    expect(response.status).toBe(200);
  });
});

describe('Role-based access control', () => {
  it('returns 403 when a USER calls an operator route', async () => {
    const station = await createStation();
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api()
      .patch(`/api/v1/stations/${station.id}`)
      .set(...user.authHeader)
      .send({ numberOfDispensers: 6 });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 when a USER calls an admin route', async () => {
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api().get('/api/v1/admin/users').set(...user.authHeader);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 when a STATION_OPERATOR calls an admin route', async () => {
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });

    const response = await api().get('/api/v1/admin/users').set(...operator.authHeader);

    expect(response.status).toBe(403);
  });

  it('lets an ADMIN reach an admin route', async () => {
    const admin = await createAndLogin({ role: UserRole.ADMIN });

    const response = await api().get('/api/v1/admin/users').set(...admin.authHeader);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.items)).toBe(true);
  });

  it('ignores a role sent in the request body', async () => {
    const station = await createStation();
    const user = await createAndLogin({ role: UserRole.USER });

    const response = await api()
      .patch(`/api/v1/stations/${station.id}`)
      .set(...user.authHeader)
      .send({ numberOfDispensers: 6, role: 'ADMIN' });

    // A client-supplied role is never an input to an authorization decision.
    expect(response.status).toBe(403);
  });
});

describe('CRITICAL: operators may only modify assigned stations', () => {
  it('allows an operator to update their assigned station', async () => {
    const stationA = await createStation({ name: 'Assigned Station' });
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, stationA.id, StationOperatorRole.MANAGER);

    const response = await api()
      .patch(`/api/v1/stations/${stationA.id}`)
      .set(...operator.authHeader)
      .send({ numberOfDispensers: 7 });

    expect(response.status).toBe(200);
    expect(response.body.data.station.numberOfDispensers).toBe(7);
  });

  it('returns 403 when an operator targets an unassigned station', async () => {
    const stationA = await createStation({ name: 'Station A' });
    const stationB = await createStation({ name: 'Station B' });

    const operatorA = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operatorA.user.id, stationA.id);

    const response = await api()
      .patch(`/api/v1/stations/${stationB.id}`)
      .set(...operatorA.authHeader)
      .send({ numberOfDispensers: 9 });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('leaves the unassigned station completely unchanged', async () => {
    const stationA = await createStation();
    const stationB = await createStation();

    const operatorA = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operatorA.user.id, stationA.id);

    const before = await prisma.station.findUnique({ where: { id: stationB.id } });

    await api()
      .patch(`/api/v1/stations/${stationB.id}`)
      .set(...operatorA.authHeader)
      .send({ numberOfDispensers: 99, active: false });

    const after = await prisma.station.findUnique({ where: { id: stationB.id } });

    expect(after?.numberOfDispensers).toBe(before?.numberOfDispensers);
    expect(after?.active).toBe(before?.active);
  });

  it('returns 403 once an assignment is revoked', async () => {
    const station = await createStation();
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    const allowed = await api()
      .patch(`/api/v1/stations/${station.id}`)
      .set(...operator.authHeader)
      .send({ numberOfDispensers: 5 });
    expect(allowed.status).toBe(200);

    await prisma.stationOperator.updateMany({
      where: { userId: operator.user.id, stationId: station.id },
      data: { active: false, revokedAt: new Date() },
    });

    // The existing access token keeps working for other things, but the
    // assignment check is re-evaluated per request.
    const denied = await api()
      .patch(`/api/v1/stations/${station.id}`)
      .set(...operator.authHeader)
      .send({ numberOfDispensers: 6 });

    expect(denied.status).toBe(403);
  });

  it('does not distinguish an unassigned station from one that does not exist', async () => {
    const stationA = await createStation();
    const stationB = await createStation();
    const missingId = '00000000-0000-4000-8000-000000000000';

    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, stationA.id);

    const unassigned = await api()
      .patch(`/api/v1/stations/${stationB.id}`)
      .set(...operator.authHeader)
      .send({ numberOfDispensers: 4 });

    const nonExistent = await api()
      .patch(`/api/v1/stations/${missingId}`)
      .set(...operator.authHeader)
      .send({ numberOfDispensers: 4 });

    // Identical responses, so the endpoint cannot be used to enumerate stations.
    expect(unassigned.status).toBe(403);
    expect(nonExistent.status).toBe(403);
    expect(nonExistent.body.error.message).toBe(unassigned.body.error.message);
  });

  it('lets an admin update any station without an assignment', async () => {
    const station = await createStation();
    const admin = await createAndLogin({ role: UserRole.ADMIN });

    const response = await api()
      .patch(`/api/v1/stations/${station.id}`)
      .set(...admin.authHeader)
      .send({ numberOfDispensers: 12 });

    expect(response.status).toBe(200);
    expect(response.body.data.station.numberOfDispensers).toBe(12);
  });

  it('returns 404 when an admin targets a station that does not exist', async () => {
    const admin = await createAndLogin({ role: UserRole.ADMIN });

    const response = await api()
      .patch('/api/v1/stations/00000000-0000-4000-8000-000000000000')
      .set(...admin.authHeader)
      .send({ numberOfDispensers: 4 });

    expect(response.status).toBe(404);
  });

  it('rejects attempts to change protected station fields', async () => {
    const station = await createStation({ name: 'Original Name' });
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    const response = await api()
      .patch(`/api/v1/stations/${station.id}`)
      .set(...operator.authHeader)
      .send({ name: 'Renamed By Operator', latitude: 0, longitude: 0 });

    expect(response.status).toBe(422);

    const after = await prisma.station.findUnique({ where: { id: station.id } });
    expect(after?.name).toBe('Original Name');
  });

  it('scopes GET /stations/mine to the calling operator', async () => {
    const stationA = await createStation({ name: 'Mine' });
    const stationB = await createStation({ name: 'Someone Elses' });

    const operatorA = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    const operatorB = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operatorA.user.id, stationA.id);
    await assignOperator(operatorB.user.id, stationB.id);

    const response = await api()
      .get('/api/v1/stations/mine')
      .set(...operatorA.authHeader);

    expect(response.status).toBe(200);
    expect(response.body.data.assignments).toHaveLength(1);
    expect(response.body.data.assignments[0].station.name).toBe('Mine');
  });
});

describe('Admin management of operator assignments', () => {
  it('assigns an operator to a station and grants access', async () => {
    const station = await createStation();
    const admin = await createAndLogin({ role: UserRole.ADMIN });
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });

    const denied = await api()
      .patch(`/api/v1/stations/${station.id}`)
      .set(...operator.authHeader)
      .send({ numberOfDispensers: 3 });
    expect(denied.status).toBe(403);

    const assign = await api()
      .post(`/api/v1/admin/stations/${station.id}/operators`)
      .set(...admin.authHeader)
      .send({ userId: operator.user.id, role: StationOperatorRole.MANAGER });
    expect(assign.status).toBe(201);

    const allowed = await api()
      .patch(`/api/v1/stations/${station.id}`)
      .set(...operator.authHeader)
      .send({ numberOfDispensers: 3 });
    expect(allowed.status).toBe(200);
  });

  it('refuses to assign a user who lacks the operator role', async () => {
    const station = await createStation();
    const admin = await createAndLogin({ role: UserRole.ADMIN });
    const plainUser = await createAndLogin({ role: UserRole.USER });

    const response = await api()
      .post(`/api/v1/admin/stations/${station.id}/operators`)
      .set(...admin.authHeader)
      .send({ userId: plainUser.user.id });

    expect(response.status).toBe(400);
  });

  it('revokes an assignment and removes access', async () => {
    const station = await createStation();
    const admin = await createAndLogin({ role: UserRole.ADMIN });
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });
    await assignOperator(operator.user.id, station.id);

    const revoke = await api()
      .delete(`/api/v1/admin/stations/${station.id}/operators/${operator.user.id}`)
      .set(...admin.authHeader);
    expect(revoke.status).toBe(200);

    const denied = await api()
      .patch(`/api/v1/stations/${station.id}`)
      .set(...operator.authHeader)
      .send({ numberOfDispensers: 3 });
    expect(denied.status).toBe(403);
  });

  it('writes an audit entry when an operator is assigned', async () => {
    const station = await createStation();
    const admin = await createAndLogin({ role: UserRole.ADMIN });
    const operator = await createAndLogin({ role: UserRole.STATION_OPERATOR });

    await api()
      .post(`/api/v1/admin/stations/${station.id}/operators`)
      .set(...admin.authHeader)
      .send({ userId: operator.user.id });

    const entries = await prisma.adminAuditLog.findMany({
      where: { action: 'OPERATOR_ASSIGNED' },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].adminUserId).toBe(admin.user.id);
  });

  it('revokes sessions when an admin deactivates a user', async () => {
    const admin = await createAndLogin({ role: UserRole.ADMIN });
    const victim = await createAndLogin({ role: UserRole.USER });

    const before = await api().get('/api/v1/auth/me').set(...victim.authHeader);
    expect(before.status).toBe(200);

    await api()
      .patch(`/api/v1/admin/users/${victim.user.id}/active`)
      .set(...admin.authHeader)
      .send({ active: false });

    const after = await api().get('/api/v1/auth/me').set(...victim.authHeader);
    expect(after.status).toBe(401);
  });

  it('stops an admin from demoting themselves', async () => {
    const admin = await createAndLogin({ role: UserRole.ADMIN });

    const response = await api()
      .patch(`/api/v1/admin/users/${admin.user.id}/role`)
      .set(...admin.authHeader)
      .send({ role: UserRole.USER });

    expect(response.status).toBe(400);
  });
});
