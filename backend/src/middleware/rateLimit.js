'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { ErrorCode } = require('../utils/ApiError');

const shared = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Rejections use the same failure envelope as everything else.
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json({
      success: false,
      error: {
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many requests, please try again later',
      },
    });
  },
  // Disabled in tests so suites are not throttled by their own volume.
  skip: () => env.isTest,
};

/** Baseline limiter for the whole API surface. */
const apiLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
});

/**
 * Login throttling, keyed by IP rather than IP+email — keying on the submitted
 * address would let an attacker sidestep the limit by varying it.
 */
const loginLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60000,
  limit: 10,
  skipSuccessfulRequests: true,
});

/** Stricter: each success creates persistent state. */
const registerLimiter = rateLimit({ ...shared, windowMs: 60 * 60000, limit: 5 });

/**
 * Coarse IP bound on reporting. The limit that actually matters is per-account
 * and per-station — see services/reportThrottle.
 */
const reportLimiter = rateLimit({ ...shared, windowMs: 60000, limit: 20 });

module.exports = { apiLimiter, loginLimiter, registerLimiter, reportLimiter };
