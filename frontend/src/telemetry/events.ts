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

export const telemetryEvents = {
  catalogueLoaded: (count: number): TelemetryEvent => ({
    eventType: 'catalogue_loaded',
    payload: { count },
  }),
  catalogueFailed: (failure: ApiFailure): TelemetryEvent => ({
    eventType: 'catalogue_failed',
    payload: { errorCode: failure },
  }),
  productViewed: (productId: number): TelemetryEvent => ({
    eventType: 'product_viewed',
    payload: { productId },
  }),
  /** `productId` is null when the route id is not a valid product id. */
  productLoadFailed: (productId: number | null, failure: ApiFailure): TelemetryEvent => ({
    eventType: 'product_load_failed',
    payload: { productId, errorCode: failure },
  }),
  cameraStarted: (productId: number): TelemetryEvent => ({
    eventType: 'camera_started',
    payload: { productId },
  }),
  cameraError: (productId: number, failure: CameraFailure | 'ended'): TelemetryEvent => ({
    eventType: 'camera_error',
    payload: { productId, errorCode: failure === 'ended' ? 'camera_ended' : CAMERA_CODES[failure] },
  }),
  trackingError: (productId: number, failure: PerceptionFailure): TelemetryEvent => ({
    eventType: 'tracking_error',
    payload: { productId, errorCode: PERCEPTION_CODES[failure] },
  }),
  renderError: (productId: number, failure: RenderFailure): TelemetryEvent => ({
    eventType: 'render_error',
    payload: { productId, errorCode: failure },
  }),
  faceDetectedChanged: (productId: number, faceDetected: boolean): TelemetryEvent => ({
    eventType: 'tracking_state_changed',
    payload: { productId, faceDetected },
  }),
};

export type TelemetryEventName = keyof typeof telemetryEvents;
