import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { logger } from './logger';

/**
 * Log levels are emitted as events so they flow through the structured logger
 * instead of Prisma's own stdout writer. The array must stay inline here —
 * Prisma derives the `$on` event names from its literal type at this call site,
 * and hoisting it to a annotated variable erases that inference.
 */
const createPrismaClient = () =>
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

/**
 * Single shared Prisma client. Cached on globalThis so dev hot-reloads do not
 * open a new connection pool on every restart.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.isDevelopment) {
  globalForPrisma.prisma = prisma;
  prisma.$on('query', (e) => {
    logger.debug({ query: e.query, durationMs: e.duration }, 'prisma query');
  });
}

prisma.$on('warn', (e) => logger.warn({ target: e.target }, e.message));
prisma.$on('error', (e) => logger.error({ target: e.target }, e.message));

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connection established');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database connection closed');
}
