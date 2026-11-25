import {
  TELEMETRY_EVENT_TYPES,
  product,
  productList,
  type TelemetryEvent,
} from '@facefit/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.js';
import { buildApp, postJson, seededDatabase } from './helpers.js';

// One event per type in the shape the frontend's builders produce
// (frontend/src/telemetry/events.ts).
const EVENTS: TelemetryEvent[] = [
  { eventType: 'catalogue_loaded', payload: { count: 4 } },
  { eventType: 'catalogue_failed', payload: { errorCode: 'network' } },
  { eventType: 'product_viewed', payload: { productId: 1 } },
  { eventType: 'product_load_failed', payload: { productId: null, errorCode: 'not_found' } },
  { eventType: 'camera_started', payload: { productId: 1 } },
  { eventType: 'camera_error', payload: { productId: 1, errorCode: 'permission_denied' } },
  { eventType: 'tracking_error', payload: { productId: 1, errorCode: 'worker_crash' } },
  { eventType: 'render_error', payload: { productId: 1, errorCode: 'webgl_unavailable' } },
  { eventType: 'tracking_state_changed', payload: { productId: 1, faceDetected: true } },
];

describe('API contract', () => {
  let database: Database;
  beforeAll(async () => {
    database = await seededDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  it('serves products in the shared product schema', async () => {
    const { app } = buildApp(database);
    const list = productList.parse(await (await app.request('/api/products')).json());
    expect(list.length).toBeGreaterThan(0);
    const one = product.parse(await (await app.request('/api/products/1')).json());
    expect(one.attribution.title).not.toBe('');
  });

  it('covers every telemetry event type', () => {
    expect(EVENTS.map((event) => event.eventType).sort()).toEqual(
      [...TELEMETRY_EVENT_TYPES].sort(),
    );
  });

  it.each(EVENTS)('accepts $eventType', async (event) => {
    const { app } = buildApp(database);
    const response = await postJson(app, { ...event, timestamp: new Date().toISOString() });
    expect(response.status).toBe(202);
  });
});
