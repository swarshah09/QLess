import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config/env';
import { ErrorCode } from '../errors/errorCodes';
import { errorBody } from '../utils/apiResponse';

const sharedOptions: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Rate-limit rejections must use the same failure envelope as everything else.
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json(
      errorBody(ErrorCode.RATE_LIMITED, 'Too many requests, please try again later'),
    );
  },
};

/** Baseline limiter applied to the whole API surface. */
export const apiRateLimiter = rateLimit({
  ...sharedOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  // Disabled in tests so suites are not throttled by their own volume.
  skip: () => env.isTest,
});

/**
 * Tighter limiter for write-heavy or abuse-prone endpoints (crowd reports,
 * auth). Exported now so later phases attach it rather than inventing new
 * limits ad hoc.
 */
export const strictRateLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60_000,
  limit: 20,
  skip: () => env.isTest,
});

/**
 * Login throttling: 10 attempts per 15 minutes per IP.
 *
 * Keyed by IP alone rather than by IP+email — keying on the submitted email
 * would let an attacker sidestep the limit by varying the address, and would
 * itself leak which addresses are being probed.
 */
export const loginRateLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60_000,
  limit: 10,
  // Successful logins should not count toward a legitimate user's budget.
  skipSuccessfulRequests: true,
  skip: () => env.isTest,
});

/**
 * Registration throttling. Stricter than login because each success creates
 * persistent state, and because the endpoint necessarily reveals whether an
 * email is already taken.
 */
export const registerRateLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60 * 60_000,
  limit: 5,
  skip: () => env.isTest,
});

/**
 * Coarse IP-level bound on crowd reporting.
 *
 * This is only a first line of defence. The limit that actually matters is
 * per-account and per-station, which an IP key cannot express — see
 * `services/reportThrottle.service`, which enforces cooldowns, hourly caps and
 * duplicate detection against the database.
 */
export const reportRateLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 60_000,
  limit: 20,
  skip: () => env.isTest,
});

/**
 * Refresh throttling. Generous — a legitimate client refreshes on a timer — but
 * bounded so a stolen token cannot be ground against the endpoint.
 */
export const refreshRateLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60_000,
  limit: 60,
  skip: () => env.isTest,
});
