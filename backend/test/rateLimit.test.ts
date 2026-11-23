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

describe('rate limits beyond the API routes', () => {
  let database: Database;
  beforeAll(async () => {
    database = await seededDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  it('counts preflight requests', async () => {
    const { app } = buildApp(database, { rateLimitMax: 3 });
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await app.request('/api/telemetry', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:3000', ...from('7.7.7.7').headers },
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([204, 204, 204, 429, 429, 429]);
  });

  it('counts unknown paths outside /api', async () => {
    const { app } = buildApp(database, { rateLimitMax: 2 });
    const statuses: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      statuses.push((await app.request(`/scan/${String(index)}`, from('7.7.7.8'))).status);
    }
    expect(statuses).toEqual([404, 404, 429, 429]);
  });

  it('caps the path length written to the access log', async () => {
    const { app, lines } = buildApp(database);
    await app.request(`/${'a'.repeat(5_000)}`);
    expect(lines.join('\n').length).toBeLessThan(1_000);
  });

  it('includes the request id in 404, 413, 415, 403 and 429 bodies', async () => {
    const { app } = buildApp(database, { rateLimitMax: 6 });
    const headers = from('7.7.7.9').headers;
    const bodies = [
      await app.request('/api/products/99', { headers }),
      await app.request('/nope', { headers }),
      await postJson(app, `{"pad":"${'x'.repeat(4_096)}"}`, headers),
      await app.request('/api/telemetry', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'text/plain' },
        body: '{}',
      }),
      await app.request('/api/products', {
        headers: { ...headers, origin: 'https://evil.example' },
      }),
      await app.request('/api/products', { headers }),
    ];
    const limited = await app.request('/api/products', { headers });
    const expected = [404, 404, 413, 415, 403, 200];
    expect(bodies.map((response) => response.status)).toEqual(expected);
    expect(limited.status).toBe(429);
    for (const response of [...bodies.slice(0, 5), limited]) {
      const body = (await response.json()) as { requestId?: string };
      expect(body.requestId).toBe(response.headers.get('x-request-id'));
    }
  });

  it('keeps a steady client when renewed windows share the map with newer keys', async () => {
    let clock = 0;
    const app = limitedApp({ max: 1, now: () => clock, maxTrackedClients: 4 });
    await app.request('/', from('1.0.0.1'));
    clock = 500;
    await app.request('/', from('1.0.0.2'));
    clock = 600;
    await app.request('/', from('1.0.0.3'));
    clock = 1_000;
    await app.request('/', from('1.0.0.1'));
    clock = 1_050;
    await app.request('/', from('1.0.0.4'));
    clock = 1_100;
    await app.request('/', from('1.0.0.5'));
    expect((await app.request('/', from('1.0.0.1'))).status).toBe(429);
  });
});
