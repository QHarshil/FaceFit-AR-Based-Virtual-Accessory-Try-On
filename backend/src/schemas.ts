import { z } from 'zod';

const MAX_INT4 = 2_147_483_647;

// A digit-only string keeps "1e2", "0x10" and "1.0" from coercing to a valid id.
export const productIdParam = z.strictObject({
  id: z
    .string()
    .regex(/^[1-9]\d{0,9}$/)
    .transform(Number)
    .pipe(z.number().max(MAX_INT4)),
});

export const noQuery = z.strictObject({});

export const TELEMETRY_EVENT_TYPES = [
  'catalogue_loaded',
  'catalogue_failed',
  'product_viewed',
  'product_load_failed',
  'camera_started',
  'camera_error',
  'tracking_state_changed',
] as const;

export const TELEMETRY_ERROR_CODES = [
  'network',
  'not_found',
  'permission_denied',
  'timeout',
  'unsupported',
  'unknown',
] as const;

// Every value is a number, boolean or enum member, so a payload cannot carry free text.
export const telemetryPayload = z.strictObject({
  count: z.number().int().min(0).max(1_000).optional(),
  productId: z.number().int().positive().max(MAX_INT4).nullable().optional(),
  faceDetected: z.boolean().optional(),
  errorCode: z.enum(TELEMETRY_ERROR_CODES).optional(),
});

export const telemetryBody = z.strictObject({
  eventType: z.enum(TELEMETRY_EVENT_TYPES),
  payload: telemetryPayload.default({}),
  timestamp: z.iso.datetime().optional(),
});

export type TelemetryBody = z.infer<typeof telemetryBody>;
