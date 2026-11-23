import type { AppConfig } from '../src/app.js';
import { createApp } from '../src/app.js';
import { openDatabase, type Database } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';
import { createLogger } from '../src/logger.js';

export const ALLOWED_ORIGIN = 'http://localhost:3000';

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  corsOrigins: [ALLOWED_ORIGIN],
  trustProxy: true,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 1_000,
  telemetryRateLimitMax: 1_000,
  requestTimeoutMs: 5_000,
  ...overrides,
});

export const seededDatabase = async (): Promise<Database> => {
  const database = await openDatabase('pglite://memory');
  await database.migrate();
  await seedProducts(database.db);
  return database;
};

export const buildApp = (
  database: Database,
  overrides: Partial<AppConfig> = {},
  isShuttingDown?: () => boolean,
) => {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line));
  const app = createApp({
    config: testConfig(overrides),
    database,
    logger,
    ...(isShuttingDown ? { isShuttingDown } : {}),
  });
  return { app, lines };
};

export const postJson = (
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request('/api/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
