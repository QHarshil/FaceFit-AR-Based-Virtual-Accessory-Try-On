import { PERCEPTION_ASSETS } from '../perception/assets';
import { startFrameSource } from '../perception/frameSource';
import { startLandmarker } from '../perception/landmarkerClient';
import type { LandmarkFrame } from '../perception/types';
import { probe } from '../utils/probe';
import { startCamera } from './camera';

export interface FaceTracking {
  /** Resolves once frames are flowing. Rejects if the camera or model cannot start. */
  started: Promise<void>;
  /** Safe to call at any point, including before `started` settles. */
  stop: () => void;
}

export interface FaceTrackingCallbacks {
  /** One call per processed camera frame, with or without a face. */
  onLandmarks: (frame: LandmarkFrame) => void;
  /** A failure after `started` resolved. Tracking has stopped when this runs. */
  onError: (error: unknown) => void;
}

// Sessions share one video element, and the camera attaches its stream when
// getUserMedia resolves. Starting a camera only after the previous one has
// settled keeps a late stream from replacing the live one.
let previousSession: Promise<void> = Promise.resolve();

/**
 * Starts the camera and the landmark worker together, then streams camera
 * frames to the worker.
 *
 * React StrictMode runs effect cleanup right after setup. A stop before the
 * camera starts means it never starts. A stop while the camera is starting
 * releases the stream once it arrives.
 */
export const startFaceTracking = (
  video: HTMLVideoElement,
  { onLandmarks, onError }: FaceTrackingCallbacks,
): FaceTracking => {
  let active = true;
  let releaseCamera: (() => void) | null = null;
  let stopFrames: (() => void) | null = null;

  const stop = () => {
    if (!active) return;
    active = false;
    stopFrames?.();
    landmarker.stop();
    releaseCamera?.();
  };

  const failRunning = (error: unknown) => {
    if (!active) return;
    stop();
    onError(error);
  };

  const landmarker = startLandmarker({
    assets: PERCEPTION_ASSETS,
    onResult: (frame) => {
      if (active) onLandmarks(frame);
    },
    onError: failRunning,
  });

  const cameraStarted = previousSession.then(async () => {
    if (!active) return;
    const release = await startCamera(video);
    if (active) releaseCamera = release;
    else release();
  });
  previousSession = cameraStarted.catch(() => {});

  const started = (async () => {
    await cameraStarted;
    if (!active) return;
    let delegate;
    try {
      delegate = await landmarker.ready;
    } catch (error) {
      if (!active) return;
      throw error;
    }
    if (!active) return;
    probe({ stage: 'perceptionReady', delegate });
    stopFrames = startFrameSource(video, {
      onFrame: (captured) => {
        landmarker.submit(captured);
      },
      onError: failRunning,
    });
  })();
  // A failed start releases the camera and the worker; the caller still sees the rejection.
  started.catch(stop);

  return { started, stop };
};
