import { execSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Runs once before the whole suite: brings the test database up to the current
 * schema. `migrate deploy` applies committed migrations without prompting, so
 * it is safe to run unattended.
 */
export default function globalSetup(): void {
  process.env.NODE_ENV = 'test';

  const envPath = path.resolve(process.cwd(), '.env.test');
  dotenv.config({ path: envPath });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set — check .env.test');
  }

  // Guard against a misconfigured .env.test pointing at real data: the suite
  // truncates tables between tests.
  if (!/qless_test/.test(databaseUrl)) {
    throw new Error(
      `Refusing to run tests against "${databaseUrl}" — the database name must contain "qless_test"`,
    );
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
