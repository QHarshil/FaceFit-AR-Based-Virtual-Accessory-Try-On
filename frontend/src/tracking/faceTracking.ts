import type { LandmarkList } from '../types';
import { probe } from '../utils/probe';
import { Camera, FaceMesh } from './mediapipeGlobals';

export interface FaceTracking {
  /** Resolves once frames are flowing. Rejects if the camera or model cannot start. */
  started: Promise<void>;
  /** Safe to call at any point, including before `started` settles. */
  stop: () => void;
}

// Sessions share one video element, and the camera attaches its stream when
// getUserMedia resolves. Starting a camera only after the previous one has
// settled keeps a late stream from replacing the live one.
let previousSession: Promise<void> = Promise.resolve();

/**
 * Starts the camera and the face landmark model. `onLandmarks` receives the first
 * face of each frame, or null when no face is found.
 *
 * React StrictMode runs effect cleanup right after setup. A stop before the
 * camera starts means it never starts. A stop while `Camera.start()` is pending
 * stops the camera once the stream arrives, because `Camera.stop()` only knows
 * about a stream that has already been attached.
 */
export const startFaceTracking = (
  video: HTMLVideoElement,
  onLandmarks: (landmarks: LandmarkList | null) => void,
): FaceTracking => {
  let active = true;

  const faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  faceMesh.onResults((results) => {
    if (!active) return;
    onLandmarks(results.multiFaceLandmarks[0] ?? null);
  });

  const camera = new Camera(video, {
    onFrame: async () => {
      if (!active) return;
      const sendStart = performance.now();
      await faceMesh.send({ image: video });
      probe({ stage: 'send', start: sendStart, end: performance.now() });
    },
    width: 1280,
    height: 720,
  });

  const started = previousSession.then(async () => {
    if (!active) return;
    await camera.start();
    if (!active) await camera.stop();
  });
  previousSession = started.catch(() => {});

  const stop = () => {
    if (!active) return;
    active = false;
    void camera.stop();
    void faceMesh.close();
  };

  return { started, stop };
};
