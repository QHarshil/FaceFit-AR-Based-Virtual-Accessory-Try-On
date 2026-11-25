import { z } from 'zod';
import { productId } from './products.js';

export const TELEMETRY_ERROR_CODES = [
  'network',
  'not_found',
  'invalid_response',
  'server_error',
  'permission_denied',
  'timeout',
  'unsupported',
  'unknown',
  'camera_missing',
  'camera_busy',
  'camera_ended',
  'model_fetch',
  'wasm_fetch',
  'worker_crash',
  'capture_unsupported',
  'model_load',
  'webgl_unavailable',
  'context_lost',
  'render_crash',
] as const;

export type TelemetryErrorCode = (typeof TELEMETRY_ERROR_CODES)[number];

const errorCode = z.enum(TELEMETRY_ERROR_CODES);
const timestamp = z.iso.datetime().optional();

// Every payload value is a number, boolean or enum member, so an event cannot
// carry free text. Each event type allows only its own keys.
export const telemetryBody = z.discriminatedUnion('eventType', [
  z.strictObject({
    eventType: z.literal('catalogue_loaded'),
    payload: z.strictObject({ count: z.number().int().min(0).max(1_000).optional() }).default({}),
    timestamp,
  }),
  z.strictObject({
    eventType: z.literal('catalogue_failed'),
    payload: z.strictObject({ errorCode: errorCode.optional() }).default({}),
    timestamp,
  }),
  z.strictObject({
    eventType: z.literal('product_viewed'),
    payload: z.strictObject({ productId }),
    timestamp,
  }),
  z.strictObject({
    eventType: z.literal('product_load_failed'),
    payload: z.strictObject({ productId: productId.nullable(), errorCode }),
    timestamp,
  }),
  z.strictObject({
    eventType: z.literal('camera_started'),
    payload: z.strictObject({ productId: productId.optional() }).default({}),
    timestamp,
  }),
  z.strictObject({
    eventType: z.literal('camera_error'),
    payload: z
      .strictObject({ productId: productId.optional(), errorCode: errorCode.optional() })
      .default({}),
    timestamp,
  }),
  z.strictObject({
    eventType: z.literal('tracking_error'),
    payload: z
      .strictObject({ productId: productId.optional(), errorCode: errorCode.optional() })
      .default({}),
    timestamp,
  }),
  z.strictObject({
    eventType: z.literal('render_error'),
    payload: z
      .strictObject({ productId: productId.optional(), errorCode: errorCode.optional() })
      .default({}),
    timestamp,
  }),
  z.strictObject({
    eventType: z.literal('tracking_state_changed'),
    payload: z
      .strictObject({
        productId: productId.nullable().optional(),
        faceDetected: z.boolean().optional(),
      })
      .default({}),
    timestamp,
  }),
]);

export const TELEMETRY_EVENT_TYPES = telemetryBody.options.map(
  (option) => option.shape.eventType.value,
);

/** What a client sends; the payload may be left out where every key is optional. */
export type TelemetryEvent = z.input<typeof telemetryBody>;
export type TelemetryEventType = TelemetryEvent['eventType'];
export type TelemetryBody = z.output<typeof telemetryBody>;

/** Largest telemetry body the backend reads, in bytes. */
export const MAX_TELEMETRY_BYTES = 2_048;
