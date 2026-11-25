import { describe, expect, it } from 'vitest';
import {
  TELEMETRY_ERROR_CODES,
  TELEMETRY_EVENT_TYPES,
  telemetryBody,
  type TelemetryEvent,
} from '../src/index.js';

const VALID: TelemetryEvent[] = [
  { eventType: 'catalogue_loaded', payload: { count: 4 } },
  { eventType: 'catalogue_loaded' },
  { eventType: 'catalogue_failed', payload: { errorCode: 'network' } },
  { eventType: 'product_viewed', payload: { productId: 2 } },
  { eventType: 'product_load_failed', payload: { productId: null, errorCode: 'not_found' } },
  { eventType: 'camera_started', payload: { productId: 1 } },
  { eventType: 'camera_error', payload: { productId: 1, errorCode: 'permission_denied' } },
  { eventType: 'tracking_error', payload: { productId: 1, errorCode: 'model_fetch' } },
  { eventType: 'render_error', payload: { productId: 1, errorCode: 'context_lost' } },
  { eventType: 'tracking_state_changed', payload: { productId: null, faceDetected: false } },
];

describe('telemetryBody', () => {
  it('lists each event type once', () => {
    expect(new Set(TELEMETRY_EVENT_TYPES).size).toBe(TELEMETRY_EVENT_TYPES.length);
    expect(new Set(VALID.map((event) => event.eventType))).toEqual(new Set(TELEMETRY_EVENT_TYPES));
  });

  it.each(VALID)('accepts $eventType', (event) => {
    expect(telemetryBody.safeParse({ ...event, timestamp: '2026-11-24T12:00:00.000Z' }).success).toBe(
      true,
    );
  });

  it('uses snake case error codes only', () => {
    for (const code of TELEMETRY_ERROR_CODES) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it.each([
    ['a message', { eventType: 'catalogue_failed', payload: { message: 'timeout' } }],
    ['a string product id', { eventType: 'product_viewed', payload: { productId: '1' } }],
    ['a missing product id', { eventType: 'product_viewed' }],
    ['a hyphenated code', { eventType: 'tracking_error', payload: { errorCode: 'model-fetch' } }],
    ['a key of another event', { eventType: 'camera_started', payload: { faceDetected: true } }],
    ['an unknown top-level key', { eventType: 'camera_started', userId: 'abc' }],
    ['an unknown event', { eventType: 'purchase' }],
  ])('rejects %s', (_label, body) => {
    expect(telemetryBody.safeParse(body).success).toBe(false);
  });
});
