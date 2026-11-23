import { PerceptionError } from '../perception/errors';
import type { PerceptionErrorCode } from '../perception/protocol';

export const CAMERA_ERROR_MESSAGE =
  'Unable to start the camera. Please allow access and refresh the page.';

export const RENDER_ERROR_MESSAGE =
  '3D rendering is unavailable. Turn on hardware acceleration in your browser settings or try another browser.';

const PERCEPTION_MESSAGES: Record<PerceptionErrorCode, string> = {
  'model-fetch':
    'Could not download the face tracking model. Check your connection and refresh the page.',
  'wasm-fetch':
    'Could not load the face tracking engine. Check your connection and refresh the page.',
  worker: 'Face tracking ran into a problem. Please refresh the page.',
  inference: 'Face tracking ran into a problem. Please refresh the page.',
  unsupported:
    'Face tracking is not supported in this browser. Try a recent Chrome, Edge, Firefox or Safari.',
};

const GENERIC_MESSAGE = 'Unable to start the try-on. Please refresh the page.';

/** The message the try-on page shows for a camera or tracking failure. */
export const trackingErrorMessage = (error: unknown): string => {
  if (error instanceof PerceptionError) return PERCEPTION_MESSAGES[error.code];
  // getUserMedia and video.play reject with DOMExceptions.
  if (error instanceof DOMException) return CAMERA_ERROR_MESSAGE;
  return GENERIC_MESSAGE;
};

/** Telemetry event name for a camera or tracking failure. */
export const trackingErrorEvent = (error: unknown): 'tracking_error' | 'camera_error' =>
  error instanceof PerceptionError ? 'tracking_error' : 'camera_error';
