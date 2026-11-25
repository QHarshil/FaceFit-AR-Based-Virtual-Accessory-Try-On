// One landmark worker for the live try-on: load the model, send it camera
// frames, put its results on the pose stream and report face status changes.
import { PERCEPTION_ASSETS } from '../perception/assets';
import {
  frameCaptureSupported,
  startFrameSource,
  type FrameSourceCallbacks,
} from '../perception/frameSource';
import { startLandmarker, type LandmarkerClientOptions } from '../perception/landmarkerClient';
import { NO_FACE, type FaceStatus } from '../tryon/faceStatus';
import { probe } from '../utils/probe';
import { perceptionFailureOf, type PerceptionFailure } from './failures';
import type { PoseStream } from './poseStream';

export interface PerceptionCallbacks {
  onReady: () => void;
  onFailed: (failure: PerceptionFailure) => void;
  onFaceStatus: (status: FaceStatus) => void;
}

export interface PerceptionSession {
  /** Stops sending frames; the model stays loaded. */
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

export interface PerceptionDeps {
  startLandmarker: typeof startLandmarker;
  startFrameSource: (video: HTMLVideoElement, callbacks: FrameSourceCallbacks) => () => void;
  frameCaptureSupported: (video: HTMLVideoElement) => boolean;
  assets: LandmarkerClientOptions['assets'];
}

const DEFAULT_DEPS: PerceptionDeps = {
  startLandmarker,
  startFrameSource,
  frameCaptureSupported,
  assets: PERCEPTION_ASSETS,
};

/**
 * The model loads while the camera starts. Frames flow once the model is
 * ready and the video plays; a new stream on the same element (a camera
 * restart) restarts capture when it starts playing.
 */
export const startPerception = (
  video: HTMLVideoElement,
  poseStream: PoseStream,
  callbacks: PerceptionCallbacks,
  deps: PerceptionDeps = DEFAULT_DEPS,
): PerceptionSession => {
  let active = true;
  let ready = false;
  let paused = false;
  let stopFrames: (() => void) | null = null;

  const fail = (failure: PerceptionFailure) => {
    if (!active) return;
    session.stop();
    callbacks.onFailed(failure);
  };

  // A new attempt starts from no face, so the first frame with one is reported.
  poseStream.reset();
  let lastFace = poseStream.getSnapshot().face;
  const stopFaceStatus = poseStream.subscribe(() => {
    const { face } = poseStream.getSnapshot();
    if (!active || face === lastFace) return;
    lastFace = face;
    callbacks.onFaceStatus(face);
  });

  const startFrames = () => {
    stopFrames?.();
    stopFrames = null;
    if (!active || !ready || paused) return;
    try {
      stopFrames = deps.startFrameSource(video, {
        onFrame: (captured) => {
          poseStream.present(captured.timestampMs);
          landmarker?.submit(captured);
        },
        onError: () => {
          fail('capture_unsupported');
        },
      });
    } catch {
      fail('capture_unsupported');
    }
  };

  let landmarker: ReturnType<typeof startLandmarker> | null = null;
  const session: PerceptionSession = {
    pause() {
      paused = true;
      stopFrames?.();
      stopFrames = null;
    },
    resume() {
      if (!paused) return;
      paused = false;
      // Time passed while hidden, so the filter and face status start over.
      // The machine is back at searching, so the reset is not reported.
      lastFace = NO_FACE;
      poseStream.reset();
      startFrames();
    },
    stop() {
      if (!active) return;
      active = false;
      stopFrames?.();
      stopFrames = null;
      stopFaceStatus();
      video.removeEventListener('playing', startFrames);
      landmarker?.stop();
    },
  };

  if (!deps.frameCaptureSupported(video)) {
    queueMicrotask(() => {
      fail('capture_unsupported');
    });
    return session;
  }

  try {
    landmarker = deps.startLandmarker({
      assets: deps.assets,
      onResult: (frame) => {
        if (!active) return;
        const poseStart = performance.now();
        poseStream.push(frame);
        probe({ stage: 'pose', start: poseStart, end: performance.now() });
      },
      onError: (error) => {
        fail(perceptionFailureOf(error));
      },
    });
  } catch (error) {
    queueMicrotask(() => {
      fail(perceptionFailureOf(error));
    });
    return session;
  }

  video.addEventListener('playing', startFrames);
  landmarker.ready.then(
    (delegate) => {
      if (!active) return;
      probe({ stage: 'perceptionReady', delegate });
      ready = true;
      startFrames();
      callbacks.onReady();
    },
    (error: unknown) => {
      fail(perceptionFailureOf(error));
    },
  );
  return session;
};
