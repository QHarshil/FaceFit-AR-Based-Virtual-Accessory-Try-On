import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { createLogger } from './logger.js';
import { startServer } from './runtime.js';

const logger = createLogger();
const config = loadConfig();
const database = await openDatabase(config.databaseUrl);
const running = await startServer({ config, database, logger });

let stopping = false;
const stop = (signal: string): void => {
  logger.info('signal received', { signal });
  // A repeated signal must not end the process while requests are still draining.
  if (stopping) return;
  stopping = true;
  running.shutdown().then(
    () => process.exit(0),
    (error: unknown) => {
      logger.error('shutdown failed', { error: error instanceof Error ? error.name : 'unknown' });
      process.exit(1);
    },
  );
};
process.on('SIGTERM', () => {
  stop('SIGTERM');
});
process.on('SIGINT', () => {
  stop('SIGINT');
});
