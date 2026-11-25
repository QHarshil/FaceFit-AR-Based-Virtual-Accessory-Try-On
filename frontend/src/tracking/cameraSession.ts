// One camera attempt for the try-on: start, release the camera while the page
// is hidden and ask for it again when shown, notice the device going away,
// stop.
import { startCamera, type CameraHandle } from './camera';
import { cameraFailureOf, type CameraFailure } from './failures';

export interface CameraSessionCallbacks {
  /** The camera is streaming: on the first start, and each time the page is shown again. */
  onReady: () => void;
  onFailed: (failure: CameraFailure) => void;
  /** The track ended: unplugged, revoked, or stopped by the OS. */
  onEnded: () => void;
}

export interface CameraSession {
  /** Stops the tracks, so the browser's camera indicator goes off. */
  pause: () => void;
  /** Asks for the same camera again; reports ready or the failure. */
  resume: () => void;
  /** Safe at any point, including before the camera starts. */
  stop: () => void;
}

// Sessions share one video element, and the camera attaches its stream when
// getUserMedia resolves. Starting a camera only after the previous one has
// settled keeps a late stream from replacing the live one.
let previousSession: Promise<void> = Promise.resolve();

/**
 * React StrictMode starts and stops the try-on right away in development. A
 * stop before the camera starts means it never starts; a stop while it is
 * starting releases the stream once it arrives.
 */
export const startCameraSession = (
  video: HTMLVideoElement,
  callbacks: CameraSessionCallbacks,
  start: (video: HTMLVideoElement, deviceId: string | null) => Promise<CameraHandle> = startCamera,
): CameraSession => {
  let active = true;
  let paused = false;
  let camera: CameraHandle | null = null;
  let deviceId: string | null = null;
  // Each request gets a number; a stream that arrives after a newer request,
  // a pause or a stop is released unused.
  let request = 0;

  const onEnded = () => {
    if (active) callbacks.onEnded();
  };

  const acquire = () => {
    request += 1;
    const mine = request;
    const wanted = () => active && !paused && request === mine;
    const started = previousSession.then(async () => {
      if (!wanted()) return;
      const handle = await start(video, deviceId);
      if (!wanted()) {
        handle.release();
        return;
      }
      camera = handle;
      deviceId = handle.deviceId;
      handle.track?.addEventListener('ended', onEnded);
      callbacks.onReady();
    });
    previousSession = started.catch(() => {});
    started.catch((error: unknown) => {
      if (wanted()) callbacks.onFailed(cameraFailureOf(error));
    });
  };

  const release = () => {
    camera?.track?.removeEventListener('ended', onEnded);
    camera?.release();
    camera = null;
  };

  acquire();

  return {
    pause() {
      if (!active || paused) return;
      paused = true;
      release();
    },
    resume() {
      if (!active || !paused) return;
      paused = false;
      acquire();
    },
    stop() {
      if (!active) return;
      active = false;
      release();
    },
  };
};
