import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.js';
import { openDatabase } from '../src/db/client.js';
import { buildApp, seededDatabase } from './helpers.js';

interface ProductJson {
  id: number;
  name: string;
  modelPath: string;
  dimensionsMm: Record<string, number>;
  attribution: Record<string, string>;
}

describe('health and readiness', () => {
  let database: Database;
  beforeAll(async () => {
    database = await seededDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  it('answers liveness without touching the database', async () => {
    const { app } = buildApp(database);
    const response = await app.request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('answers readiness when the database responds', async () => {
    const { app } = buildApp(database);
    const response = await app.request('/api/ready');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
  });

  it('reports not ready while shutting down', async () => {
    const { app } = buildApp(database, {}, () => true);
    const response = await app.request('/api/ready');
    expect(response.status).toBe(503);
  });

  it('reports not ready when the ping fails', async () => {
    const failing: Database = {
      ...database,
      ping: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
    };
    const { app, lines } = buildApp(failing);
    const response = await app.request('/api/ready');
    expect(response.status).toBe(503);
    expect(lines.join('\n')).not.toContain('10.0.0.5');
  });

  it('sends security headers with a restrictive CSP on every response', async () => {
    const { app } = buildApp(database);
    for (const path of ['/api/health', '/api/products/9999', '/nope']) {
      const response = await app.request(path);
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });
});

describe('products', () => {
  let database: Database;
  beforeAll(async () => {
    database = await seededDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  it('lists the seeded catalogue with dimensions and attribution', async () => {
    const { app } = buildApp(database);
    const response = await app.request('/api/products');
    const products = (await response.json()) as ProductJson[];
    expect(response.status).toBe(200);
    expect(products.map((product) => product.id)).toEqual([1, 2, 3, 4]);
    expect(products[0]?.modelPath).toBe('/models/glasses1.glb');
    expect(products[0]?.dimensionsMm['lensWidth']).toBe(53);
    expect(products[0]?.attribution['license']).toBe('CC-BY-4.0');
    expect(products[0]?.attribution).not.toHaveProperty('title');
  });

  it('returns one product by id', async () => {
    const { app } = buildApp(database);
    const response = await app.request('/api/products/2');
    expect(response.status).toBe(200);
    expect(((await response.json()) as ProductJson).name).toBe('Oval Wire-Rim Sunglasses');
  });

  it('returns 404 for an unknown product and an unknown route', async () => {
    const { app } = buildApp(database);
    const missing = await app.request('/api/products/99');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'Product not found' });
    expect((await app.request('/api/unknown')).status).toBe(404);
  });

  it.each(['0', '-1', 'abc', '1e2', '1.5', '01', '2147483648', '%20'])(
    'rejects the product id %s',
    async (id) => {
      const { app } = buildApp(database);
      const response = await app.request(`/api/products/${id}`);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; issues: { path: string }[] };
      expect(body.error).toBe('Validation failed');
      expect(body.issues[0]?.path).toBe('id');
    },
  );

  it('rejects unknown query parameters', async () => {
    const { app } = buildApp(database);
    expect((await app.request('/api/products?debug=1')).status).toBe(400);
    expect((await app.request('/api/products/1?debug=1')).status).toBe(400);
  });
});

describe('database failure', () => {
  it('answers 503 on a closed database and the app keeps serving liveness', async () => {
    const database = await seededDatabase();
    const { app, lines } = buildApp(database);
    await database.close();

    const list = await app.request('/api/products');
    expect(list.status).toBe(503);
    expect((await app.request('/api/products/1')).status).toBe(503);
    expect((await app.request('/api/ready')).status).toBe(503);
    expect((await app.request('/api/health')).status).toBe(200);
    expect(lines.every((line) => JSON.parse(line) !== null)).toBe(true);
  });

  it('answers 503 when Postgres is unreachable', async () => {
    const database = await openDatabase('postgres://user:secret@127.0.0.1:1/facefit');
    const { app, lines } = buildApp(database);

    expect((await app.request('/api/products')).status).toBe(503);
    expect((await app.request('/api/ready')).status).toBe(503);
    expect((await app.request('/api/health')).status).toBe(200);
    expect(lines.join('\n')).not.toContain('secret');
    await database.close();
  });
});

describe('request timeout', () => {
  it('answers 504 when a handler outlives the timeout', async () => {
    const database = await seededDatabase();
    const slow: Database = { ...database, ping: () => new Promise(() => undefined) };
    const { app } = buildApp(slow, { requestTimeoutMs: 50 });
    const response = await app.request('/api/ready');
    expect(response.status).toBe(504);
    await database.close();
  });
});
