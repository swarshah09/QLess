import pino from 'pino';
import { env } from './env';

/**
 * Structured application logger. Pretty-printed locally, JSON in production so
 * log aggregators can parse it.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'qless-backend', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[redacted]',
  },
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      },
});

export type Logger = typeof logger;
