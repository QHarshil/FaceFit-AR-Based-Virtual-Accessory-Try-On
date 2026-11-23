import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.js';
import { ALLOWED_ORIGIN, buildApp, postJson, seededDatabase } from './helpers.js';

const BLOCKED_ORIGIN = 'https://evil.example';

describe('CORS allowlist', () => {
  let database: Database;
  beforeAll(async () => {
    database = await seededDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  it('echoes an allowlisted origin and allows credentials', async () => {
    const { app } = buildApp(database);
    const response = await app.request('/api/products', { headers: { origin: ALLOWED_ORIGIN } });
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('vary')).toContain('Origin');
  });

  it('lets a credentialed beacon from an allowlisted origin succeed', async () => {
    const { app } = buildApp(database);
    const preflight = await app.request('/api/telemetry', {
      method: 'OPTIONS',
      headers: {
        origin: ALLOWED_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Content-Type');

    const response = await postJson(
      app,
      { eventType: 'camera_started', payload: { productId: 1 } },
      { origin: ALLOWED_ORIGIN },
    );
    expect(response.status).toBe(202);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
  });

  it('adds no CORS headers for an origin outside the allowlist', async () => {
    const { app } = buildApp(database);
    const response = await app.request('/api/products', { headers: { origin: BLOCKED_ORIGIN } });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('adds no CORS headers to a preflight from a blocked origin', async () => {
    const { app } = buildApp(database);
    const preflight = await app.request('/api/telemetry', {
      method: 'OPTIONS',
      headers: { origin: BLOCKED_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(preflight.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('never answers with a wildcard origin', async () => {
    const { app } = buildApp(database, { corsOrigins: [] });
    const response = await app.request('/api/products', { headers: { origin: ALLOWED_ORIGIN } });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const plain = await app.request('/api/products');
    expect(plain.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('keeps CORS headers on error and rate limit responses', async () => {
    const { app } = buildApp(database, { rateLimitMax: 1 });
    const headers = { origin: ALLOWED_ORIGIN };
    await app.request('/api/health', { headers });
    const limited = await app.request('/api/health', { headers });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    const missing = await app.request('/api/products/99', { headers });
    expect(missing.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
  });
});
