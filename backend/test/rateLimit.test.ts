import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Database } from '../src/db/client.js';
import { rateLimit } from '../src/middleware/rateLimit.js';
import { buildApp, postJson, seededDatabase } from './helpers.js';

const limitedApp = (options: { max: number; now: () => number; maxTrackedClients?: number }) => {
  const app = new Hono();
  app.use(rateLimit({ windowMs: 1_000, trustProxy: true, ...options }));
  app.get('/', (c) => c.text('ok'));
  return app;
};

const from = (address: string) => ({ headers: { 'x-forwarded-for': address } });

describe('rateLimit middleware', () => {
  it('rejects requests over the limit with Retry-After', async () => {
    const app = limitedApp({ max: 2, now: () => 0 });
    expect((await app.request('/', from('1.1.1.1'))).status).toBe(200);
    expect((await app.request('/', from('1.1.1.1'))).status).toBe(200);
    const limited = await app.request('/', from('1.1.1.1'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('1');
    expect(limited.headers.get('ratelimit-remaining')).toBe('0');
  });

  it('counts each client separately', async () => {
    const app = limitedApp({ max: 1, now: () => 0 });
    expect((await app.request('/', from('1.1.1.1'))).status).toBe(200);
    expect((await app.request('/', from('2.2.2.2'))).status).toBe(200);
    expect((await app.request('/', from('1.1.1.1'))).status).toBe(429);
  });

  it('uses the last forwarded address so a forged first entry does not reset the count', async () => {
    const app = limitedApp({ max: 1, now: () => 0 });
    expect((await app.request('/', from('9.9.9.9, 3.3.3.3'))).status).toBe(200);
    expect((await app.request('/', from('8.8.8.8, 3.3.3.3'))).status).toBe(429);
  });

  it('starts a new window after the reset time', async () => {
    let clock = 0;
    const app = limitedApp({ max: 1, now: () => clock });
    await app.request('/', from('1.1.1.1'));
    expect((await app.request('/', from('1.1.1.1'))).status).toBe(429);
    clock = 1_000;
    expect((await app.request('/', from('1.1.1.1'))).status).toBe(200);
  });

  it('bounds the number of tracked clients', async () => {
    const app = limitedApp({ max: 1, now: () => 0, maxTrackedClients: 3 });
    for (let index = 1; index <= 20; index += 1) {
      expect((await app.request('/', from(`10.0.0.${index}`))).status).toBe(200);
    }
    // The oldest client was evicted, so it gets a fresh window.
    expect((await app.request('/', from('10.0.0.1'))).status).toBe(200);
  });
});

describe('rate limits on the API', () => {
  let database: Database;
  beforeAll(async () => {
    database = await seededDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  it('limits all API routes per client', async () => {
    const { app } = buildApp(database, { rateLimitMax: 3 });
    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      statuses.push((await app.request('/api/products', from('4.4.4.4'))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect((await app.request('/api/products', from('5.5.5.5'))).status).toBe(200);
  });

  it('limits telemetry more strictly than the rest of the API', async () => {
    const { app } = buildApp(database, { telemetryRateLimitMax: 2 });
    const event = { eventType: 'camera_started' };
    const statuses: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      statuses.push((await postJson(app, event, from('6.6.6.6').headers)).status);
    }
    expect(statuses).toEqual([202, 202, 429, 429]);
    expect((await app.request('/api/products', from('6.6.6.6'))).status).toBe(200);
  });
});
