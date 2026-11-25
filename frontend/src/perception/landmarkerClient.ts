// Main-thread side of the landmark worker: starts it, feeds it frames through
// the scheduler and turns its replies into landmark frames or errors.
import { probe } from '../utils/probe';
import { PerceptionError } from './errors';
import { createFrameScheduler } from './frameScheduler';
import type { CapturedFrame } from './frameSource';
import {
  isWorkerResponse,
  transferablesOf,
  type InitRequest,
  type RunningMode,
  type WorkerRequest,
} from './protocol';
import type { LandmarkFrame, PerceptionDelegate } from './types';

export interface LandmarkerClient {
  /** Resolves with the delegate that loaded. Rejects if the model cannot start or on stop. */
  ready: Promise<PerceptionDelegate>;
  /** Takes ownership of a captured frame. */
  submit: (captured: CapturedFrame) => void;
  /**
   * Landmarks of the largest face in a still image, for a client started in
   * IMAGE mode. Takes ownership of the bitmap. Rejects if the worker fails or stops.
   */
  detectImage: (image: ImageBitmap) => Promise<LandmarkFrame>;
  stop: () => void;
}

export interface LandmarkerClientOptions {
  assets: Omit<InitRequest, 'type' | 'runningMode'>;
  /** VIDEO when absent. */
  runningMode?: RunningMode;
  onResult: (frame: LandmarkFrame) => void;
  /** Errors after `ready` resolved. Earlier ones reject `ready`. The client is stopped either way. */
  onError: (error: PerceptionError) => void;
  createWorker?: () => Worker;
}

export const createLandmarkerWorker = (): Worker =>
  new Worker(new URL('./landmarker.worker.ts', import.meta.url), {
    type: 'module',
    name: 'landmarker',
  });

export const startLandmarker = ({
  assets,
  runningMode = 'VIDEO',
  onResult,
  onError,
  createWorker = createLandmarkerWorker,
}: LandmarkerClientOptions): LandmarkerClient => {
  let stopped = false;
  let readySettled = false;
  let delegate: PerceptionDelegate | null = null;
  let resolveReady: (delegate: PerceptionDelegate) => void = () => {};
  let rejectReady: (error: PerceptionError) => void = () => {};
  const ready = new Promise<PerceptionDelegate>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Callers may stop before awaiting; the rejection is still delivered to them.
  ready.catch(() => {});

  let worker: Worker;
  try {
    worker = createWorker();
  } catch (error) {
    // Module workers missing, or the CSP refusing the worker script.
    throw new PerceptionError('worker', `Cannot start the landmark worker: ${String(error)}`);
  }
  const post = (message: WorkerRequest) => {
    worker.postMessage(message, transferablesOf(message));
  };
  const capturedAt = new Map<number, number>();
  const pendingImages = new Map<
    number,
    { resolve: (frame: LandmarkFrame) => void; reject: (error: PerceptionError) => void }
  >();
  let nextImageId = 0;

  const scheduler = createFrameScheduler<CapturedFrame>({
    send: ({ frameId, timestampMs, frame, capturedAt: at }) => {
      capturedAt.set(frameId, at);
      post({ type: 'frame', frameId, timestampMs, frame });
      probe({ stage: 'frameToPost', frameId, start: at, end: performance.now() });
    },
    release: ({ frameId, frame }, reason) => {
      frame.close();
      if (reason === 'dropped') probe({ stage: 'drop', frameId });
    },
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    scheduler.stop();
    worker.terminate();
    capturedAt.clear();
    const ended = new PerceptionError('worker', 'The landmark worker stopped');
    pendingImages.forEach(({ reject }) => {
      reject(ended);
    });
    pendingImages.clear();
    if (!readySettled) {
      readySettled = true;
      rejectReady(new PerceptionError('worker', 'Stopped before the model was ready'));
    }
  };

  const fail = (error: PerceptionError) => {
    if (stopped) return;
    pendingImages.forEach(({ reject }) => {
      reject(error);
    });
    pendingImages.clear();
    if (readySettled) {
      stop();
      onError(error);
    } else {
      readySettled = true;
      rejectReady(error);
      stop();
    }
  };

  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (stopped) return;
    const receivedAt = performance.now();
    const message = event.data;
    if (!isWorkerResponse(message)) {
      fail(new PerceptionError('worker', 'Malformed message from the landmark worker'));
      return;
    }
    switch (message.type) {
      case 'ready':
        if (readySettled) return;
        readySettled = true;
        delegate = message.delegate;
        resolveReady(message.delegate);
        return;
      case 'error':
        fail(new PerceptionError(message.code, message.detail));
        return;
      case 'blocked':
        probe({ stage: 'blockedRequest', api: message.api, url: message.url });
        return;
      case 'imageResult': {
        const pending = pendingImages.get(message.requestId);
        pendingImages.delete(message.requestId);
        pending?.resolve(message.landmarkFrame);
        return;
      }
      case 'result': {
        const start = capturedAt.get(message.frameId);
        capturedAt.delete(message.frameId);
        // Dispatch the waiting frame before handling this result, so the worker
        // runs while the main thread applies the pose.
        scheduler.complete();
        if (start !== undefined) {
          probe({ stage: 'frameToLandmarks', frameId: message.frameId, start, end: receivedAt });
        }
        const inferenceStart = message.inferenceStartMs - performance.timeOrigin;
        probe({
          stage: 'inference',
          frameId: message.frameId,
          durationMs: message.inferenceMs,
          start: inferenceStart,
          end: inferenceStart + message.inferenceMs,
        });
        onResult(message.landmarkFrame);
        probe({
          stage: 'result',
          frameId: message.frameId,
          start: receivedAt,
          end: performance.now(),
        });
      }
    }
  });

  worker.addEventListener('error', (event: ErrorEvent) => {
    event.preventDefault();
    fail(new PerceptionError('worker', event.message || 'The landmark worker failed to load'));
  });
  worker.addEventListener('messageerror', () => {
    fail(new PerceptionError('worker', 'A landmark worker message could not be read'));
  });

  post({ type: 'init', ...assets, runningMode });

  const submit = (captured: CapturedFrame) => {
    // The worker rejects frames that arrive before the model loads.
    if (delegate === null) {
      captured.frame.close();
      return;
    }
    scheduler.offer(captured);
  };

  const detectImage = (image: ImageBitmap) =>
    new Promise<LandmarkFrame>((resolve, reject) => {
      if (stopped || delegate === null) {
        image.close();
        reject(new PerceptionError('worker', 'The landmark worker is not ready'));
        return;
      }
      const requestId = nextImageId;
      nextImageId += 1;
      pendingImages.set(requestId, { resolve, reject });
      post({ type: 'image', requestId, image });
    });

  return { ready, submit, detectImage, stop };
};
