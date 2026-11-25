// Camera and perception failures as the try-on reports them. Each maps a
// thrown error to the state the try-on moves to and the recovery it offers.
import { PerceptionError } from '../perception/errors';

export type CameraFailure =
  /** The user or a browser setting refused access. */
  | 'denied'
  /** No camera is connected. */
  | 'missing'
  /** Another app holds the camera, or the hardware failed to start. */
  | 'busy'
  /** The page cannot ask for a camera: no getUserMedia, often an insecure origin. */
  | 'unsupported'
  | 'unknown';

export const CAMERA_FAILURES: readonly CameraFailure[] = [
  'denied',
  'missing',
  'busy',
  'unsupported',
  'unknown',
];

// getUserMedia and video.play reject with DOMExceptions named by the spec.
const CAMERA_FAILURE_BY_NAME: Record<string, CameraFailure> = {
  NotAllowedError: 'denied',
  SecurityError: 'denied',
  NotFoundError: 'missing',
  OverconstrainedError: 'missing',
  NotReadableError: 'busy',
  AbortError: 'busy',
  NotSupportedError: 'unsupported',
};

export const cameraFailureOf = (error: unknown): CameraFailure =>
  (error instanceof DOMException && CAMERA_FAILURE_BY_NAME[error.name]) || 'unknown';

export type PerceptionFailure =
  | 'model_fetch'
  | 'wasm_fetch'
  /** No delegate could start FaceLandmarker in this browser. */
  | 'unsupported'
  /** The browser cannot hand camera frames to the worker (requestVideoFrameCallback, VideoFrame). */
  | 'capture_unsupported'
  /** The worker died or inference threw; restartable. */
  | 'crashed';

export const PERCEPTION_FAILURES: readonly PerceptionFailure[] = [
  'model_fetch',
  'wasm_fetch',
  'unsupported',
  'capture_unsupported',
  'crashed',
];

export const perceptionFailureOf = (error: unknown): PerceptionFailure => {
  if (!(error instanceof PerceptionError)) return 'crashed';
  switch (error.code) {
    case 'model-fetch':
      return 'model_fetch';
    case 'wasm-fetch':
      return 'wasm_fetch';
    case 'unsupported':
      return 'unsupported';
    case 'worker':
    case 'inference':
      return 'crashed';
  }
};
