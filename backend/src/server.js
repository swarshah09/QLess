'use strict';

const createApp = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const { API_PREFIX } = require('./config/constants');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const realtime = require('./sockets/realtime');

let server;

async function shutdown(signal, exitCode = 0) {
  logger.info('Shutting down', { signal });

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  try {
    // Sockets first, so open connections do not keep the process alive.
    await realtime.close();

    // `listening` guards a failed startup: closing a server that never bound
    // throws and would mask the real cause.
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }

    await disconnectDatabase();
    clearTimeout(forceExit);
    process.exit(exitCode);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
}

async function bootstrap() {
  await connectDatabase();

  const app = createApp();

  // Awaited so a bind failure rejects here with a clear message rather than
  // reaching the uncaughtException handler as an anonymous fatal.
  server = await new Promise((resolve, reject) => {
    const httpServer = app.listen(env.PORT, () => {
      logger.info(`QLess backend listening on port ${env.PORT}`, {
        port: env.PORT,
        env: env.NODE_ENV,
        healthcheck: `${API_PREFIX}/health`,
      });
      resolve(httpServer);
    });

    httpServer.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(
          `Port ${env.PORT} is already in use — stop the other process (lsof -nP -iTCP:${env.PORT} -sTCP:LISTEN) or set a different PORT`,
        );
      }
      reject(error);
    });
  });

  // Attached to the same HTTP server, so realtime shares the port and CORS
  // configuration with the REST API.
  realtime.attach(server);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => void shutdown(signal));
  }
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: String(reason) });
  void shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  void shutdown('uncaughtException', 1);
});

bootstrap().catch((error) => {
  logger.error('Failed to start server', { error: error.message });
  process.exit(1);
});
