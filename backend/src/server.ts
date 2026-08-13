import type { Server } from 'node:http';
import { createApp } from './app';
import { API_PREFIX } from './config/constants';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectDatabase, disconnectDatabase } from './config/prisma';
import {
  createRealtimeGateway,
  getRealtimeGateway,
  noopGateway,
  setRealtimeGateway,
} from './sockets/realtime.gateway';

let server: Server | undefined;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  logger.info({ signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    // Sockets first: close them before the HTTP server so open connections do
    // not keep the process alive past the shutdown deadline.
    await getRealtimeGateway().close();
    setRealtimeGateway(noopGateway);

    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await disconnectDatabase();
    clearTimeout(forceExit);
    process.exit(exitCode);
  } catch (error) {
    logger.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
}

async function bootstrap(): Promise<void> {
  // env is validated on import; failing here means the database is unreachable.
  await connectDatabase();

  const app = createApp();

  server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, healthcheck: `${API_PREFIX}/health` },
      `QLess backend listening on port ${env.PORT}`,
    );
  });

  // Attached to the same HTTP server, so realtime shares the port and CORS
  // configuration with the REST API.
  setRealtimeGateway(createRealtimeGateway(server));
  logger.info({ path: '/socket.io' }, 'Realtime gateway attached');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});

bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start server');
  process.exit(1);
});
