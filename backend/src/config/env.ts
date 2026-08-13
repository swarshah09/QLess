import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { DEFAULT_LOCATION_VERIFICATION_RADIUS_M } from './constants';

// Tests load `.env.test` so a test run can never point at the development
// database and truncate it. Everything else uses `.env`.
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

/**
 * Environment schema. Anything required here is validated at startup so the
 * process fails fast and loudly rather than at the first request.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Comma-separated list of allowed browser origins.
  FRONTEND_URL: z.string().min(1, 'FRONTEND_URL is required'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),

  /// Access-token lifetime. Kept short because access tokens are stateless and
  /// cannot be revoked before they expire.
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  /// Refresh-session lifetime. These ARE revocable, so they can live longer.
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /// bcrypt work factor. 12 is a reasonable production floor.
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  /// Geofence radius, in metres, inside which a report counts as first-hand.
  /// Tunable per deployment: dense urban forecourts may want it tighter,
  /// highway stations looser.
  LOCATION_VERIFICATION_RADIUS_M: z.coerce
    .number()
    .int()
    .positive()
    .max(5_000)
    .default(DEFAULT_LOCATION_VERIFICATION_RADIUS_M),

  /// Web Push (VAPID). Optional: without them the notification engine still
  /// evaluates rules and records events, it just cannot deliver.
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  /// Contact address push services use for abuse reports; required by the spec.
  VAPID_SUBJECT: z.string().default('support@qless.example'),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  JSON_BODY_LIMIT: z.string().default('100kb'),
});

export type RawEnv = z.infer<typeof envSchema>;

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    // Logger depends on env, so this one case writes straight to stderr.
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${details}`);
    process.exit(1);
  }

  const value = parsed.data;

  if (value.NODE_ENV === 'production') {
    const weak = ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;
    for (const key of weak) {
      if (value[key].includes('replace-me') || value[key].startsWith('dev-only')) {
        // eslint-disable-next-line no-console
        console.error(`${key} still holds a placeholder value in production.`);
        process.exit(1);
      }
    }

    // Reusing one secret for both token types means an access token could be
    // replayed as a refresh token.
    if (value.JWT_SECRET === value.JWT_REFRESH_SECRET) {
      // eslint-disable-next-line no-console
      console.error('JWT_SECRET and JWT_REFRESH_SECRET must be different values.');
      process.exit(1);
    }
  }

  return value;
}

const raw = loadEnv();

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.FRONTEND_URL.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const;

export type Env = typeof env;
