// Messages between the main thread and the landmark worker. Frames go in as
// transferred VideoFrames; landmarks come back in a transferred Float32Array.
import {
  LANDMARK_COUNT,
  LANDMARK_STRIDE,
  type LandmarkFrame,
  type PerceptionDelegate,
} from './types';

export type PerceptionErrorCode =
  'model-fetch' | 'wasm-fetch' | 'worker' | 'unsupported' | 'inference';

export interface InitRequest {
  type: 'init';
  /** Directory holding the pinned module WASM pair, same origin as the app. */
  wasmBaseUrl: string;
  modelUrl: string;
}

export interface FrameRequest {
  type: 'frame';
  frameId: number;
  timestampMs: number;
  frame: VideoFrame;
}

export type WorkerRequest = InitRequest | FrameRequest;

export interface ReadyResponse {
  type: 'ready';
  delegate: PerceptionDelegate;
}

export interface ResultResponse {
  type: 'result';
  frameId: number;
  /**
   * `detectForVideo` start as `performance.timeOrigin + performance.now()` in
   * the worker. Subtracting the main thread's `performance.timeOrigin` gives
   * the main thread's clock.
   */
  inferenceStartMs: number;
  /** `detectForVideo` duration measured in the worker. */
  inferenceMs: number;
  landmarkFrame: LandmarkFrame;
}

export interface ErrorResponse {
  type: 'error';
  code: PerceptionErrorCode;
  detail: string;
  /**
   * The frame that failed, when the error came from one. Every error is fatal,
   * per-frame ones included: the client stops the worker and reports it.
   */
  frameId?: number;
}

export type WorkerResponse = ReadyResponse | ResultResponse | ErrorResponse;

const ERROR_CODES: readonly PerceptionErrorCode[] = [
  'model-fetch',
  'wasm-fetch',
  'worker',
  'unsupported',
  'inference',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isFrameId = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

// Structural check: VideoFrame does not exist in every environment that loads
// this module, and a transferred frame is a different object than the sender's.
const isVideoFrame = (value: unknown): value is VideoFrame =>
  isRecord(value) &&
  typeof value.close === 'function' &&
  isFiniteNumber(value.displayWidth) &&
  isFiniteNumber(value.displayHeight);

export const isLandmarkFrame = (value: unknown): value is LandmarkFrame => {
  if (!isRecord(value)) return false;
  const { timestampMs, width, height, landmarks, faceCount } = value;
  if (!isFiniteNumber(timestampMs) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return false;
  }
  if (!Number.isInteger(faceCount) || (faceCount as number) < 0) return false;
  if (!(landmarks instanceof Float32Array)) return false;
  const expected = faceCount === 0 ? 0 : LANDMARK_COUNT * LANDMARK_STRIDE;
  return landmarks.length === expected;
};

export const isWorkerRequest = (value: unknown): value is WorkerRequest => {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'init':
      return typeof value.wasmBaseUrl === 'string' && typeof value.modelUrl === 'string';
    case 'frame':
      return (
        isFrameId(value.frameId) && isFiniteNumber(value.timestampMs) && isVideoFrame(value.frame)
      );
    default:
      return false;
  }
};

export const isWorkerResponse = (value: unknown): value is WorkerResponse => {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'ready':
      return value.delegate === 'GPU' || value.delegate === 'CPU';
    case 'result':
      return (
        isFrameId(value.frameId) &&
        isFiniteNumber(value.inferenceStartMs) &&
        isFiniteNumber(value.inferenceMs) &&
        isLandmarkFrame(value.landmarkFrame)
      );
    case 'error':
      return (
        ERROR_CODES.includes(value.code as PerceptionErrorCode) &&
        typeof value.detail === 'string' &&
        (value.frameId === undefined || isFrameId(value.frameId))
      );
    default:
      return false;
  }
};

/** Objects to move, not copy, with a message. */
export const transferablesOf = (message: WorkerRequest | WorkerResponse): Transferable[] => {
  switch (message.type) {
    case 'frame':
      return [message.frame];
    case 'result':
      return [message.landmarkFrame.landmarks.buffer];
    default:
      return [];
  }
};
