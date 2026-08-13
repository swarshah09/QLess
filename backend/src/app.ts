import cookieParser from 'cookie-parser';
import cors, { type CorsOptions } from 'cors';
import express, { type Application } from 'express';
import helmet from 'helmet';
import { API_PREFIX } from './config/constants';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { apiRateLimiter } from './middleware/rateLimiter';
import { requestLogger } from './middleware/requestLogger';
import routes from './routes';

/**
 * CORS policy. The backend is consumed by the web/PWA frontend today and by
 * native Android/iOS clients later — native apps send no Origin header, so
 * originless requests are allowed through.
 */
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (env.corsOrigins.includes(origin)) return callback(null, true);
    logger.warn({ origin }, 'Blocked request from disallowed origin');
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 86_400,
};

export function createApp(): Application {
  const app = express();

  // Correct client IPs behind a reverse proxy, which rate limiting depends on.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors(corsOptions));

  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.JSON_BODY_LIMIT }));
  // Web clients carry the refresh token in an httpOnly cookie; native clients
  // send it in the request body instead.
  app.use(cookieParser());

  app.use(requestLogger);
  app.use(API_PREFIX, apiRateLimiter);

  app.use(API_PREFIX, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
