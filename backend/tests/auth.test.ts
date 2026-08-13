import { UserRole } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import {
  TEST_PASSWORD,
  api,
  createAndLogin,
  createUser,
  disconnect,
  resetDatabase,
} from './helpers';

beforeEach(resetDatabase);
afterAll(disconnect);

describe('POST /api/v1/auth/register', () => {
  it('creates an account and returns tokens', async () => {
    const response = await api().post('/api/v1/auth/register').send({
      name: 'New Person',
      email: 'new.person@qless.test',
      password: 'AStrongPassword123',
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe('new.person@qless.test');
    expect(response.body.data.tokens.accessToken).toBeTruthy();
    expect(response.body.data.tokens.refreshToken).toBeTruthy();
    expect(response.body.data.tokens.tokenType).toBe('Bearer');
  });

  it('never returns the password hash', async () => {
    const response = await api().post('/api/v1/auth/register').send({
      name: 'Hash Check',
      email: 'hash.check@qless.test',
      password: 'AStrongPassword123',
    });

    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('stores the password as a bcrypt hash, never in plaintext', async () => {
    await api().post('/api/v1/auth/register').send({
      name: 'Storage Check',
      email: 'storage.check@qless.test',
      password: 'AStrongPassword123',
    });

    const stored = await prisma.user.findUnique({
      where: { email: 'storage.check@qless.test' },
    });

    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe('AStrongPassword123');
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('always creates a USER, ignoring a role supplied by the client', async () => {
    const response = await api().post('/api/v1/auth/register').send({
      name: 'Would Be Admin',
      email: 'escalate@qless.test',
      password: 'AStrongPassword123',
      role: 'ADMIN',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.user.role).toBe(UserRole.USER);

    const stored = await prisma.user.findUnique({ where: { email: 'escalate@qless.test' } });
    expect(stored?.role).toBe(UserRole.USER);
  });

  it('rejects a duplicate email with 409', async () => {
    await createUser({ email: 'taken@qless.test' });

    const response = await api().post('/api/v1/auth/register').send({
      name: 'Second Attempt',
      email: 'taken@qless.test',
      password: 'AStrongPassword123',
    });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects a short password', async () => {
    const response = await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Weak', email: 'weak@qless.test', password: 'short' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('succeeds with valid credentials', async () => {
    const user = await createUser({ email: 'valid.login@qless.test' });

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'valid.login@qless.test', password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.id).toBe(user.id);
    expect(response.body.data.tokens.accessToken).toBeTruthy();
  });

  it('accepts the email case-insensitively', async () => {
    await createUser({ email: 'case.test@qless.test' });

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'CASE.TEST@QLess.Test', password: TEST_PASSWORD });

    expect(response.status).toBe(200);
  });

  it('rejects a wrong password with 401', async () => {
    await createUser({ email: 'wrong.password@qless.test' });

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'wrong.password@qless.test', password: 'NotTheRightOne1' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.data).toBeUndefined();
  });

  it('gives an identical response for unknown and wrong-password emails', async () => {
    await createUser({ email: 'exists@qless.test' });

    const wrongPassword = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'exists@qless.test', password: 'NotTheRightOne1' });

    const unknownEmail = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'does.not.exist@qless.test', password: 'NotTheRightOne1' });

    // The API must not be usable to discover which addresses have accounts.
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('rejects a deactivated account without revealing why', async () => {
    await createUser({ email: 'inactive@qless.test', active: false });

    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'inactive@qless.test', password: TEST_PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body.error.message).not.toMatch(/inactive|disabled|deactivat/i);
  });

  it('records the login timestamp', async () => {
    const user = await createUser({ email: 'timestamp@qless.test' });
    expect(user.lastLoginAt).toBeNull();

    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'timestamp@qless.test', password: TEST_PASSWORD });

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.lastLoginAt).not.toBeNull();
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('exchanges a refresh token for a new token pair', async () => {
    const { refreshToken } = await createAndLogin();

    const response = await api().post('/api/v1/auth/refresh').send({ refreshToken });

    expect(response.status).toBe(200);
    expect(response.body.data.tokens.accessToken).toBeTruthy();
    // Rotation: the returned refresh token must be a new one.
    expect(response.body.data.tokens.refreshToken).not.toBe(refreshToken);
  });

  it('revokes the old token after rotation', async () => {
    const { refreshToken } = await createAndLogin();

    await api().post('/api/v1/auth/refresh').send({ refreshToken });
    const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken });

    expect(replay.status).toBe(401);
  });

  it('revokes the whole session family when a used token is replayed', async () => {
    const { user, refreshToken } = await createAndLogin();

    const rotated = await api().post('/api/v1/auth/refresh').send({ refreshToken });
    const currentToken = rotated.body.data.tokens.refreshToken;

    // Replaying the consumed token signals a leak.
    await api().post('/api/v1/auth/refresh').send({ refreshToken });

    // The legitimate holder's current token is killed too, forcing a re-login.
    const afterBreach = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: currentToken });

    expect(afterBreach.status).toBe(401);

    const live = await prisma.authSession.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });

    expect(response.status).toBe(401);
  });

  it('rejects an access token used as a refresh token', async () => {
    const { accessToken } = await createAndLogin();

    const response = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: accessToken });

    expect(response.status).toBe(401);
  });

  it('requires a refresh token', async () => {
    const response = await api().post('/api/v1/auth/refresh').send({});
    expect(response.status).toBe(401);
  });

  it('stores refresh tokens only as a hash', async () => {
    const { refreshToken } = await createAndLogin();

    const sessions = await prisma.authSession.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).not.toBe(refreshToken);
    expect(sessions[0].tokenHash).toHaveLength(64);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('invalidates the refresh token', async () => {
    const { refreshToken } = await createAndLogin();

    const logout = await api().post('/api/v1/auth/logout').send({ refreshToken });
    expect(logout.status).toBe(200);
    expect(logout.body.data.loggedOut).toBe(true);

    const refresh = await api().post('/api/v1/auth/refresh').send({ refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('invalidates the access token as well, because the session is gone', async () => {
    const { refreshToken, authHeader } = await createAndLogin();

    const before = await api().get('/api/v1/auth/me').set(...authHeader);
    expect(before.status).toBe(200);

    await api().post('/api/v1/auth/logout').send({ refreshToken });

    // A stateless JWT would still verify here; the session check is what stops it.
    const after = await api().get('/api/v1/auth/me').set(...authHeader);
    expect(after.status).toBe(401);
  });

  it('succeeds for an unknown token rather than leaking its validity', async () => {
    const response = await api()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: 'never-existed' });

    expect(response.status).toBe(200);
    expect(response.body.data.loggedOut).toBe(true);
  });

  it('logout-all revokes every session for the user', async () => {
    const user = await createUser({ email: 'many.devices@qless.test' });

    const first = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    const second = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });

    const response = await api()
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${first.body.data.tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.revokedSessions).toBe(2);

    const stillValid = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: second.body.data.tokens.refreshToken });
    expect(stillValid.status).toBe(401);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the authenticated profile', async () => {
    const { user, authHeader } = await createAndLogin({ name: 'Profile Person' });

    const response = await api().get('/api/v1/auth/me').set(...authHeader);

    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe(user.id);
    expect(response.body.data.user.name).toBe('Profile Person');
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('returns 401 without a token', async () => {
    const response = await api().get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a malformed token', async () => {
    const response = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.jwt');

    expect(response.status).toBe(401);
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const jwt = await import('jsonwebtoken');
    const forged = jwt.default.sign(
      { sub: 'someone', role: 'ADMIN', sid: 'x', type: 'access' },
      'a-completely-different-secret',
      { issuer: 'qless-api', audience: 'qless-clients', expiresIn: 900 },
    );

    const response = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${forged}`);

    expect(response.status).toBe(401);
  });

  it('ignores a non-bearer scheme', async () => {
    const { accessToken } = await createAndLogin();

    const response = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Basic ${accessToken}`);

    expect(response.status).toBe(401);
  });

  it('reflects the stored role, not the role in the token claim', async () => {
    const { user, authHeader } = await createAndLogin({ role: UserRole.USER });

    // Promote after the token was minted; the claim still says USER.
    await prisma.user.update({
      where: { id: user.id },
      data: { role: UserRole.ADMIN },
    });

    const response = await api().get('/api/v1/auth/me').set(...authHeader);

    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe(UserRole.ADMIN);
  });

  it('rejects a token belonging to a deactivated account', async () => {
    const { user, authHeader } = await createAndLogin();

    await prisma.user.update({ where: { id: user.id }, data: { active: false } });

    const response = await api().get('/api/v1/auth/me').set(...authHeader);
    expect(response.status).toBe(401);
  });
});
