import { prisma } from '../config/prisma';

/**
 * Data layer for health checks. All database access lives in repositories so
 * services stay free of Prisma specifics.
 */
export const healthRepository = {
  /** Round-trips a trivial query to confirm the connection actually works. */
  async ping(): Promise<number> {
    const startedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return Date.now() - startedAt;
  },
};
