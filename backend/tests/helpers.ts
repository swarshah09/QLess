import { randomUUID } from 'node:crypto';
import {
  type Station,
  StationOperatorRole,
  type User,
  UserRole,
} from '@prisma/client';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { hashPassword } from '../src/utils/password';

export const app = createApp();
export const api = () => request(app);

export const TEST_PASSWORD = 'TestPassw0rd!2026';

/** Cached so the suite pays the bcrypt cost once rather than per fixture. */
let cachedHash: string | null = null;
async function testPasswordHash(): Promise<string> {
  if (!cachedHash) cachedHash = await hashPassword(TEST_PASSWORD);
  return cachedHash;
}

/**
 * Empties every table between tests. Truncating with CASCADE and RESTART
 * IDENTITY in one statement is far faster than ordered deleteMany calls and
 * does not require keeping the dependency order in sync with the schema.
 */
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let userCounter = 0;

export async function createUser(overrides: Partial<{
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  password: string;
}> = {}): Promise<User> {
  userCounter += 1;

  const passwordHash = overrides.password
    ? await hashPassword(overrides.password)
    : await testPasswordHash();

  return prisma.user.create({
    data: {
      name: overrides.name ?? `Test User ${userCounter}`,
      // The counter alone is not enough: fixtures created inside a Promise.all
      // land in the same millisecond, so a timestamp would collide.
      email:
        overrides.email ??
        `user${userCounter}.${randomUUID().slice(0, 8)}@qless.test`,
      role: overrides.role ?? UserRole.USER,
      active: overrides.active ?? true,
      passwordHash,
    },
  });
}

let stationCounter = 0;

export async function createStation(
  overrides: Partial<{ name: string; active: boolean; latitude: number; longitude: number }> = {},
): Promise<Station> {
  stationCounter += 1;

  return prisma.station.create({
    data: {
      name: overrides.name ?? `Test Station ${stationCounter}`,
      address: `${stationCounter} Test Road`,
      city: 'Ahmedabad',
      state: 'Gujarat',
      latitude: overrides.latitude ?? 23.03 + stationCounter * 0.001,
      longitude: overrides.longitude ?? 72.56 + stationCounter * 0.001,
      active: overrides.active ?? true,
      numberOfDispensers: 4,
    },
  });
}

export async function assignOperator(
  userId: string,
  stationId: string,
  role: StationOperatorRole = StationOperatorRole.STAFF,
): Promise<void> {
  await prisma.stationOperator.create({ data: { userId, stationId, role } });
}

export interface LoggedInUser {
  user: User;
  accessToken: string;
  refreshToken: string;
  authHeader: [string, string];
}

/**
 * Creates a user and logs them in through the real HTTP endpoint, so tests
 * exercise the same token issuance path production uses rather than minting
 * tokens directly.
 */
export async function createAndLogin(
  overrides: Parameters<typeof createUser>[0] = {},
): Promise<LoggedInUser> {
  const user = await createUser(overrides);

  const response = await api()
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: overrides.password ?? TEST_PASSWORD });

  if (response.status !== 200) {
    throw new Error(`Test login failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  const { accessToken, refreshToken } = response.body.data.tokens;

  return {
    user,
    accessToken,
    refreshToken,
    authHeader: ['Authorization', `Bearer ${accessToken}`],
  };
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
