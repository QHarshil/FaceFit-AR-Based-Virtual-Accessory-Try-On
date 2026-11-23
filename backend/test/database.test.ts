import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDatabase, type Database } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';
import { createLogger } from '../src/logger.js';
import { startServer } from '../src/runtime.js';
import { buildApp } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('local PGlite database', () => {
  it('serves what separate migrate and seed processes wrote to the same directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'facefit-pglite-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const url = `pglite://${dir}/nested/not-yet-created/db`;

    const migrating = await openDatabase(url);
    await migrating.migrate();
    await migrating.close();
    const seeding = await openDatabase(url);
    await seedProducts(seeding.db);
    await seeding.close();

    const serving = await openDatabase(url);
    cleanups.push(() => serving.close());
    const { app } = buildApp(serving);
    const products = await app.request('/api/products');
    expect(products.status).toBe(200);
    expect(((await products.json()) as unknown[]).length).toBe(4);
    expect((await app.request('/api/ready')).status).toBe(200);
  });

  it('is not ready before migrations have run', async () => {
    const database = await openDatabase('pglite://memory');
    cleanups.push(() => database.close());
    const { app } = buildApp(database);
    expect((await app.request('/api/ready')).status).toBe(503);
    expect((await app.request('/api/health')).status).toBe(200);
  });
});

// Answers the Postgres startup message, then never replies to a query.
const silentPostgres = async (): Promise<{ url: string; sockets: Set<Socket>; server: Server }> => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('data', () => {
      const authOk = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]);
      const ready = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);
      socket.write(Buffer.concat([authOk, ready]));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  return { url: `postgres://u:p@127.0.0.1:${String(port)}/db`, sockets, server };
};

describe('a Postgres server that stops answering', () => {
  it('answers 503 once the query deadline passes, well before the request timeout', async () => {
    const { url } = await silentPostgres();
    const database = await openDatabase(url, { queryTimeoutMs: 300 });
    const { app } = buildApp(database, { requestTimeoutMs: 5_000 });
    const started = performance.now();

    const response = await app.request('/api/products');

    expect(response.status).toBe(503);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect((await app.request('/api/ready')).status).toBe(503);
  });

  it('finishes shutdown within the shutdown timeout when the pool cannot close', async () => {
    const stuck: Database = {
      ping: () => Promise.resolve(),
      migrate: () => Promise.resolve(),
      close: () => new Promise<void>(() => undefined),
      db: (await openDatabase('pglite://memory')).db,
    };
    const config = {
      ...loadConfig({ DATABASE_URL: 'pglite://memory', SHUTDOWN_TIMEOUT_MS: '300' }),
      port: 0,
    };
    const running = await startServer({
      config,
      database: stuck,
      logger: createLogger(() => undefined),
    });
    const started = performance.now();

    await running.shutdown();

    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
