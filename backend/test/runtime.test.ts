import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { Database } from '../src/db/client.js';
import { createLogger } from '../src/logger.js';
import { startServer } from '../src/runtime.js';
import { seededDatabase } from './helpers.js';

const config = { ...loadConfig({ DATABASE_URL: 'pglite://memory', PORT: '1' }), port: 0 };
const logger = createLogger(() => undefined);

describe('graceful shutdown', () => {
  it('stops accepting connections and closes the database pool once', async () => {
    const database = await seededDatabase();
    let closed = 0;
    const tracked: Database = {
      ...database,
      close: async () => {
        closed += 1;
        await database.close();
      },
    };
    const running = await startServer({ config, database: tracked, logger });
    const base = `http://127.0.0.1:${String(running.port)}`;
    expect((await fetch(`${base}/api/health`)).status).toBe(200);

    await Promise.all([running.shutdown(), running.shutdown()]);

    expect(closed).toBe(1);
    await expect(fetch(`${base}/api/health`)).rejects.toThrow();
  });

  it('lets an in-flight request finish before the pool closes', async () => {
    const database = await seededDatabase();
    let releasePing: () => void = () => undefined;
    let pingStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      pingStarted = resolve;
    });
    let closedAt = 0;
    let respondedAt = 0;
    const tracked: Database = {
      ...database,
      ping: () =>
        new Promise<void>((resolve) => {
          releasePing = resolve;
          pingStarted();
        }),
      close: async () => {
        closedAt = performance.now();
        await database.close();
      },
    };
    const running = await startServer({ config, database: tracked, logger });
    const inFlight = fetch(`http://127.0.0.1:${String(running.port)}/api/ready`).then(
      (response) => {
        respondedAt = performance.now();
        return response;
      },
    );
    await started;

    const stopping = running.shutdown();
    releasePing();
    const response = await inFlight;
    await stopping;

    expect(response.status).toBe(200);
    expect(respondedAt).toBeLessThanOrEqual(closedAt);
    expect(closedAt).toBeGreaterThan(0);
  });
});
