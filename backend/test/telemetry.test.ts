import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.js';
import { buildApp, postJson, seededDatabase } from './helpers.js';

describe('POST /api/telemetry', () => {
  let database: Database;
  beforeAll(async () => {
    database = await seededDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  it('accepts a known event with allowlisted payload keys', async () => {
    const { app, lines } = buildApp(database);
    const response = await postJson(app, {
      eventType: 'tracking_state_changed',
      payload: { productId: 2, faceDetected: true },
      timestamp: '2026-11-23T12:00:00.000Z',
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'accepted' });
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logged.find((entry) => entry['msg'] === 'telemetry')).toMatchObject({
      eventType: 'tracking_state_changed',
      payload: { productId: 2, faceDetected: true },
    });
  });

  it('accepts the payload shapes the frontend sends, with a null product id and no payload', async () => {
    const { app } = buildApp(database);
    expect(
      (
        await postJson(app, {
          eventType: 'tracking_state_changed',
          payload: { productId: null, faceDetected: false },
        })
      ).status,
    ).toBe(202);
    expect((await postJson(app, { eventType: 'catalogue_loaded' })).status).toBe(202);
  });

  it.each([
    ['an unknown event type', { eventType: 'purchase' }],
    ['a missing event type', { payload: {} }],
    ['an unknown top-level field', { eventType: 'camera_started', userId: 'abc' }],
    ['an unknown payload key', { eventType: 'camera_error', payload: { email: 'a@b.com' } }],
    [
      'free text in place of an error code',
      { eventType: 'camera_error', payload: { errorCode: 'NotAllowedError: Permission denied' } },
    ],
    ['a message string', { eventType: 'catalogue_failed', payload: { message: 'timeout' } }],
    ['a count out of range', { eventType: 'catalogue_loaded', payload: { count: 1_000_000 } }],
    ['a non-integer product id', { eventType: 'product_viewed', payload: { productId: 1.5 } }],
    ['a string product id', { eventType: 'product_viewed', payload: { productId: '1' } }],
    ['a bad timestamp', { eventType: 'camera_started', timestamp: 'yesterday' }],
    ['a non-object payload', { eventType: 'camera_started', payload: 'x' }],
  ])('rejects %s', async (_label, body) => {
    const { app } = buildApp(database);
    const response = await postJson(app, body);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('Validation failed');
  });

  it('rejects malformed JSON and an empty body', async () => {
    const { app } = buildApp(database);
    expect((await postJson(app, '{"eventType":')).status).toBe(400);
    expect((await postJson(app, '')).status).toBe(400);
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', ''])(
    'rejects the content type "%s" with 415',
    async (contentType) => {
      const { app } = buildApp(database);
      const response = await app.request('/api/telemetry', {
        method: 'POST',
        headers: contentType ? { 'content-type': contentType } : {},
        body: JSON.stringify({ eventType: 'camera_started' }),
      });
      expect(response.status).toBe(415);
    },
  );

  it('accepts the content type a beacon Blob sends, with a charset', async () => {
    const { app } = buildApp(database);
    const response = await app.request('/api/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ eventType: 'camera_started' }),
    });
    expect(response.status).toBe(202);
  });

  it('rejects an oversized body with 413', async () => {
    const { app } = buildApp(database);
    const body = JSON.stringify({
      eventType: 'camera_started',
      payload: {},
      pad: 'x'.repeat(4_096),
    });
    const response = await postJson(app, body);
    expect(response.status).toBe(413);
  });

  it('rejects unknown query parameters', async () => {
    const { app } = buildApp(database);
    const response = await app.request('/api/telemetry?debug=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventType: 'camera_started' }),
    });
    expect(response.status).toBe(400);
  });

  it('does not log the client address, forwarding headers or user agent', async () => {
    const { app, lines } = buildApp(database);
    await postJson(
      app,
      { eventType: 'camera_started', payload: { productId: 1 } },
      {
        'x-forwarded-for': '203.0.113.77',
        'x-real-ip': '203.0.113.78',
        'user-agent': 'TestBrowser/1.0',
        origin: 'http://localhost:3000',
      },
    );
    const output = lines.join('\n');
    expect(output).not.toContain('203.0.113');
    expect(output).not.toContain('TestBrowser');
    expect(output).not.toContain('localhost:3000');
  });

  it('does not log rejected payload values', async () => {
    const { app, lines } = buildApp(database);
    await postJson(app, { eventType: 'camera_error', payload: { email: 'person@example.com' } });
    expect(lines.join('\n')).not.toContain('person@example.com');
  });
});

describe('request ids and logs', () => {
  let database: Database;
  beforeAll(async () => {
    database = await seededDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  it('generates a request id, returns it and writes JSON logs that carry it', async () => {
    const { app, lines } = buildApp(database);
    const response = await app.request('/api/products/1');
    const requestId = response.headers.get('x-request-id') ?? '';
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const entry = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'info',
      msg: 'request',
      requestId,
      method: 'GET',
      path: '/api/products/1',
      status: 200,
    });
    expect(typeof entry['durationMs']).toBe('number');
  });

  it('keeps a well-formed caller request id and replaces a malformed one', async () => {
    const { app } = buildApp(database);
    const kept = await app.request('/api/health', {
      headers: { 'x-request-id': 'trace-12345678' },
    });
    expect(kept.headers.get('x-request-id')).toBe('trace-12345678');
    const replaced = await app.request('/api/health', {
      headers: { 'x-request-id': 'bad id with spaces' },
    });
    expect(replaced.headers.get('x-request-id')).not.toContain('bad');
  });

  it('does not put the query string in the access log', async () => {
    const { app, lines } = buildApp(database);
    await app.request('/api/products?token=secret-value');
    expect(lines.join('\n')).not.toContain('secret-value');
  });
});
