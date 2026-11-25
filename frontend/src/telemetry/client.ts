import { MAX_TELEMETRY_BYTES, telemetryBody, type TelemetryEvent } from '@facefit/contracts';
import type { BuiltTelemetryEvent } from './events';
import { createTelemetryLimiter, type TelemetryLimiter } from './limiter';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5055';
export const TELEMETRY_ENDPOINT = `${API_URL}/api/telemetry`;

export interface TelemetryTransport {
  /** Returns false when the body could not be queued. */
  beacon?: (url: string, body: Blob) => boolean;
  post: (url: string, body: string) => Promise<unknown>;
}

export interface TelemetryClientOptions {
  endpoint: string;
  transport: TelemetryTransport;
  limiter: TelemetryLimiter;
  now: () => Date;
}

export interface TelemetryClient {
  /** Validates, budgets and sends one event. Returns true when it was handed to the browser. */
  send(event: BuiltTelemetryEvent | null): boolean;
}

/** Same key for events that differ only in the timestamp. */
const keyOf = (event: TelemetryEvent) => JSON.stringify([event.eventType, event.payload ?? {}]);

export const createTelemetryClient = ({
  endpoint,
  transport,
  limiter,
  now,
}: TelemetryClientOptions): TelemetryClient => ({
  send(event) {
    if (!event) return false;
    const at = now();
    // The backend validates with the same schema, so anything this rejects
    // would come back as a 400.
    const body = telemetryBody.safeParse({ ...event, timestamp: at.toISOString() });
    if (!body.success) {
      if (import.meta.env.DEV) console.warn('Dropped invalid telemetry event', event.eventType);
      return false;
    }
    const json = JSON.stringify(body.data);
    if (json.length > MAX_TELEMETRY_BYTES) return false;
    if (!limiter.admit(keyOf(event), at.getTime())) return false;
    if (transport.beacon?.(endpoint, new Blob([json], { type: 'application/json' }))) return true;
    void transport.post(endpoint, json).catch(() => undefined);
    return true;
  },
});

const browserTransport: TelemetryTransport = {
  beacon: (url, body) =>
    typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, body),
  post: (url, body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }),
};

const defaultClient = createTelemetryClient({
  endpoint: TELEMETRY_ENDPOINT,
  transport: browserTransport,
  limiter: createTelemetryLimiter(),
  now: () => new Date(),
});

/** Sends an event built by `telemetryEvents` (events.ts). Null is ignored. */
export const sendTelemetry = (event: BuiltTelemetryEvent | null): boolean =>
  defaultClient.send(event);
