'use strict';

const path = require('node:path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({
  path: path.resolve(
    process.cwd(),
    process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
  ),
});

/**
 * Environment schema. Anything required here is checked at startup so the
 * process fails immediately with a readable message rather than at the first
 * request that happens to need it.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  /** Comma-separated list of browser origins allowed by CORS. */
  FRONTEND_URL: z.string().min(1, 'FRONTEND_URL is required'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),

  /** Web Push. Optional — without it rules still evaluate, they just don't deliver. */
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_SUBJECT: z.string().default('support@qless.example'),

  /**
   * Server-side key for the place provider (Places API New).
   *
   * Optional: without it discovery falls back to MongoDB-only, so the app still
   * runs. Must be a SEPARATE key from the browser's Maps key — this one is
   * unrestricted by referrer and must never be sent to the client.
   */
  GOOGLE_PLACES_API_KEY: z.string().optional().default(''),

  /** Geofence radius (metres) inside which a report counts as first-hand. */
  LOCATION_VERIFICATION_RADIUS_M: z.coerce.number().int().positive().default(200),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  JSON_BODY_LIMIT: z.string().default('100kb'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // The logger depends on env, so this one case writes straight to stderr.
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

const value = parsed.data;

if (value.NODE_ENV === 'production') {
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (value[key].includes('replace-me') || value[key].startsWith('dev-only')) {
      console.error(`${key} still holds a placeholder value in production.`);
      process.exit(1);
    }
  }
  // Reusing one secret would let an access token be replayed as a refresh token.
  if (value.JWT_SECRET === value.JWT_REFRESH_SECRET) {
    console.error('JWT_SECRET and JWT_REFRESH_SECRET must be different values.');
    process.exit(1);
  }
}

module.exports = {
  ...value,
  isProduction: value.NODE_ENV === 'production',
  isTest: value.NODE_ENV === 'test',
  corsOrigins: value.FRONTEND_URL.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};
