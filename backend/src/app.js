'use strict';

const compression = require('compression');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const logger = require('./config/logger');
const { API_PREFIX } = require('./config/constants');
const { apiLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { ApiError } = require('./utils/ApiError');
const routes = require('./routes');

/**
 * CORS policy. The backend serves the web/PWA frontend today and native
 * Android/iOS clients later — native apps send no Origin header, so originless
 * requests are allowed through.
 */
const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (env.corsOrigins.includes(origin)) return callback(null, true);

    logger.warn('Blocked request from disallowed origin', {
      origin,
      allowed: env.corsOrigins,
    });
    // An ApiError rather than a bare Error: a rejected origin is a client
    // mistake and should surface as 403, not a generic 500.
    return callback(
      ApiError.forbidden(`Origin ${origin} is not allowed by this server's CORS policy`),
    );
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 86400,
};

function createApp() {
  const app = express();

  // Correct client IPs behind a reverse proxy, which rate limiting depends on.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors(corsOptions));
  app.use(compression());

  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.JSON_BODY_LIMIT }));
  // Web clients carry the refresh token in an httpOnly cookie.
  app.use(cookieParser());

  if (!env.isTest && env.LOG_LEVEL !== 'silent') {
    app.use(
      morgan('tiny', {
        // Health checks are polled constantly and would drown real traffic.
        skip: (req) => req.originalUrl.startsWith(`${API_PREFIX}/health`),
        stream: { write: (line) => logger.info(line.trim()) },
      }),
    );
  }

  app.use(API_PREFIX, apiLimiter);
  app.use(API_PREFIX, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
