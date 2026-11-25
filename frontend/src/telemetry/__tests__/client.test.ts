import { telemetryBody } from '@facefit/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createTelemetryClient, TELEMETRY_ENDPOINT, type TelemetryTransport } from '../client';
import { telemetryEvents } from '../events';
import { createTelemetryLimiter } from '../limiter';

const NOW = new Date('2026-11-24T12:00:00.000Z');

const clientWith = (transport: TelemetryTransport, maxPerWindow = 10) =>
  createTelemetryClient({
    endpoint: TELEMETRY_ENDPOINT,
    transport,
    limiter: createTelemetryLimiter({ maxPerWindow, windowMs: 60_000, dedupeMs: 30_000 }),
    now: () => NOW,
  });

const blobText = (blob: Blob) => blob.text();

describe('createTelemetryClient', () => {
  it('sends a schema-valid body with a timestamp through sendBeacon', async () => {
    const beacon = vi.fn<(url: string, body: Blob) => boolean>().mockReturnValue(true);
    const post = vi.fn();
    const client = clientWith({ beacon, post });

    expect(client.send(telemetryEvents.catalogueLoaded(4))).toBe(true);

    expect(post).not.toHaveBeenCalled();
    const [url, blob] = beacon.mock.calls[0] ?? [];
    expect(url).toBe(TELEMETRY_ENDPOINT);
    expect(blob?.type).toBe('application/json');
    const body: unknown = JSON.parse(await blobText(blob as Blob));
    expect(telemetryBody.parse(body)).toEqual({
      eventType: 'catalogue_loaded',
      payload: { count: 4 },
      timestamp: NOW.toISOString(),
    });
  });

  it('falls back to fetch when the beacon is refused or missing', () => {
    const post = vi.fn().mockResolvedValue(undefined);
    expect(clientWith({ beacon: () => false, post }).send(telemetryEvents.productViewed(1))).toBe(
      true,
    );
    expect(clientWith({ post }).send(telemetryEvents.productViewed(2))).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith(TELEMETRY_ENDPOINT, expect.stringContaining('"productId":2'));
  });

  it('does not let a failed fetch reject', async () => {
    const post = vi.fn().mockRejectedValue(new TypeError('offline'));
    clientWith({ post }).send(telemetryEvents.productViewed(1));
    await expect(Promise.resolve()).resolves.toBeUndefined();
  });

  it('drops events the backend would reject', () => {
    const post = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = clientWith({ post });
    expect(client.send(telemetryEvents.productViewed(0))).toBe(false);
    expect(client.send(telemetryEvents.catalogueLoaded(1.5))).toBe(false);
    expect(client.send(null)).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('drops a repeat and stops at the budget', () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const client = clientWith({ post }, 2);
    expect(client.send(telemetryEvents.faceDetectedChanged(1, true))).toBe(true);
    expect(client.send(telemetryEvents.faceDetectedChanged(1, true))).toBe(false);
    expect(client.send(telemetryEvents.faceDetectedChanged(1, false))).toBe(true);
    expect(client.send(telemetryEvents.cameraStarted(1))).toBe(false);
    expect(post).toHaveBeenCalledTimes(2);
  });
});
