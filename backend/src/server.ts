import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { createLogger } from './logger.js';
import { startServer } from './runtime.js';

const logger = createLogger();
const config = loadConfig();
const database = await openDatabase(config.databaseUrl);
const running = await startServer({ config, database, logger });

const stop = (signal: string): void => {
  logger.info('signal received', { signal });
  running.shutdown().then(
    () => process.exit(0),
    (error: unknown) => {
      logger.error('shutdown failed', { error: error instanceof Error ? error.name : 'unknown' });
      process.exit(1);
    },
  );
};
process.once('SIGTERM', () => {
  stop('SIGTERM');
});
process.once('SIGINT', () => {
  stop('SIGINT');
});
