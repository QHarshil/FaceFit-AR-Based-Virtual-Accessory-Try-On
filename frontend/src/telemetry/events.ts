// The only place telemetry payloads are built. Every builder takes domain
// values and returns an event the backend's schema accepts; the contract test
// (__tests__/contract.test.ts) runs each builder over every input it can get.
import type { TelemetryErrorCode, TelemetryEvent } from '@facefit/contracts';
import type { ApiFailure } from '../services/apiClient';
import type { CameraFailure, PerceptionFailure } from '../tracking/failures';

/** Overlay failures: no WebGL, a GLB that failed to load, a lost context, a render crash. */
export type RenderFailure = 'webgl_unavailable' | 'model_load' | 'context_lost' | 'render_crash';

export const RENDER_FAILURES: readonly RenderFailure[] = [
  'webgl_unavailable',
  'model_load',
  'context_lost',
  'render_crash',
];

const CAMERA_CODES: Record<CameraFailure, TelemetryErrorCode> = {
  denied: 'permission_denied',
  missing: 'camera_missing',
  busy: 'camera_busy',
  unsupported: 'unsupported',
  unknown: 'unknown',
};

const PERCEPTION_CODES: Record<PerceptionFailure, TelemetryErrorCode> = {
  model_fetch: 'model_fetch',
  wasm_fetch: 'wasm_fetch',
  unsupported: 'unsupported',
  capture_unsupported: 'capture_unsupported',
  crashed: 'worker_crash',
};

declare const builtHere: unique symbol;

/**
 * An event made by `telemetryEvents`. The brand exists only in types, so
 * `sendTelemetry` does not compile with a payload built anywhere else.
 */
export type BuiltTelemetryEvent = TelemetryEvent & { readonly [builtHere]: true };

const built = (event: TelemetryEvent) => event as BuiltTelemetryEvent;

// Session events leave the product out when the id is unknown.
const withProduct = (productId: number | null) => (productId === null ? {} : { productId });

export const telemetryEvents = {
  catalogueLoaded: (count: number): BuiltTelemetryEvent =>
    built({
      eventType: 'catalogue_loaded',
      payload: { count },
    }),
  catalogueFailed: (failure: ApiFailure): BuiltTelemetryEvent =>
    built({
      eventType: 'catalogue_failed',
      payload: { errorCode: failure },
    }),
  productViewed: (productId: number): BuiltTelemetryEvent =>
    built({
      eventType: 'product_viewed',
      payload: { productId },
    }),
  /** `productId` is null when the route id is not a valid product id. */
  productLoadFailed: (productId: number | null, failure: ApiFailure): BuiltTelemetryEvent =>
    built({
      eventType: 'product_load_failed',
      payload: { productId, errorCode: failure },
    }),
  cameraStarted: (productId: number | null): BuiltTelemetryEvent =>
    built({
      eventType: 'camera_started',
      payload: withProduct(productId),
    }),
  cameraError: (productId: number | null, failure: CameraFailure | 'ended'): BuiltTelemetryEvent =>
    built({
      eventType: 'camera_error',
      payload: {
        ...withProduct(productId),
        errorCode: failure === 'ended' ? 'camera_ended' : CAMERA_CODES[failure],
      },
    }),
  trackingError: (productId: number | null, failure: PerceptionFailure): BuiltTelemetryEvent =>
    built({
      eventType: 'tracking_error',
      payload: { ...withProduct(productId), errorCode: PERCEPTION_CODES[failure] },
    }),
  renderError: (productId: number | null, failure: RenderFailure): BuiltTelemetryEvent =>
    built({
      eventType: 'render_error',
      payload: { ...withProduct(productId), errorCode: failure },
    }),
  faceDetectedChanged: (productId: number | null, faceDetected: boolean): BuiltTelemetryEvent =>
    built({
      eventType: 'tracking_state_changed',
      payload: { ...withProduct(productId), faceDetected },
    }),
};

export type TelemetryEventName = keyof typeof telemetryEvents;
