import { env } from '../config/env';
import { logger } from '../config/logger';
import { healthRepository } from '../repositories/health.repository';

export interface HealthStatus {
  status: 'ok';
}

export interface DetailedHealthStatus {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  environment: string;
  version: string;
  timestamp: string;
  dependencies: {
    database: {
      status: 'up' | 'down';
      latencyMs?: number;
    };
  };
}

export const healthService = {
  /** Liveness: the process is up and serving. */
  getStatus(): HealthStatus {
    return { status: 'ok' };
  },

  /** Readiness: dependencies are reachable too. */
  async getDetailedStatus(): Promise<DetailedHealthStatus> {
    let database: DetailedHealthStatus['dependencies']['database'] = { status: 'down' };

    try {
      const latencyMs = await healthRepository.ping();
      database = { status: 'up', latencyMs };
    } catch (error) {
      logger.error({ err: error }, 'Database health check failed');
    }

    return {
      status: database.status === 'up' ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      environment: env.NODE_ENV,
      version: process.env.npm_package_version ?? '1.0.0',
      timestamp: new Date().toISOString(),
      dependencies: { database },
    };
  },
};
