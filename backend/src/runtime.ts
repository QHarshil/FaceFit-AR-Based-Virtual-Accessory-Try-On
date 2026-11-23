import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import type { Logger } from './logger.js';

export interface RunningServer {
  port: number;
  shutdown(): Promise<void>;
}

export interface RuntimeDeps {
  config: Config;
  database: Database;
  logger: Logger;
}

const HEADERS_TIMEOUT_MS = 15_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;

const withDeadline = (work: Promise<void>, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const finish = (): void => {
      clearTimeout(timer);
      resolve();
    };
    work.then(finish, finish);
  });

const closeServer = (server: Server, timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    // After the drain deadline, sockets that are still open are cut so shutdown cannot hang.
    const deadline = setTimeout(() => {
      server.closeAllConnections();
    }, timeoutMs);
    server.close(() => {
      clearTimeout(deadline);
      resolve();
    });
    server.closeIdleConnections();
  });

export const startServer = async ({
  config,
  database,
  logger,
}: RuntimeDeps): Promise<RunningServer> => {
  let shuttingDown = false;
  const app = createApp({ config, database, logger, isShuttingDown: () => shuttingDown });

  const server = await new Promise<Server>((resolve) => {
    const created = serve({ fetch: app.fetch, port: config.port }, () => {
      resolve(created as Server);
    });
  });
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  logger.info('listening', { port });

  let stopping: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    stopping ??= (async () => {
      shuttingDown = true;
      logger.info('shutdown started');
      const deadline = Date.now() + config.shutdownTimeoutMs;
      await closeServer(server, config.shutdownTimeoutMs);
      // A pool end waits for checked-out clients, which a silent server never returns.
      await withDeadline(database.close(), Math.max(0, deadline - Date.now()));
      logger.info('shutdown complete');
    })();
    return stopping;
  };

  return { port, shutdown };
};
