// One camera attempt for the try-on: start, pause while the page is hidden,
// notice the device going away, stop.
import { startCamera, type CameraHandle } from './camera';
import { cameraFailureOf, type CameraFailure } from './failures';

export interface CameraSessionCallbacks {
  onReady: () => void;
  onFailed: (failure: CameraFailure) => void;
  /** The track ended: unplugged, revoked, or stopped by the OS. */
  onEnded: () => void;
}

export interface CameraSession {
  pause: () => void;
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
  start: (video: HTMLVideoElement) => Promise<CameraHandle> = startCamera,
): CameraSession => {
  let active = true;
  let paused = false;
  let camera: CameraHandle | null = null;

  const onEnded = () => {
    if (active) callbacks.onEnded();
  };

  const started = previousSession.then(async () => {
    if (!active) return;
    const handle = await start(video);
    if (!active) {
      handle.release();
      return;
    }
    camera = handle;
    handle.track?.addEventListener('ended', onEnded);
    callbacks.onReady();
  });
  previousSession = started.catch(() => {});
  started.catch((error: unknown) => {
    if (active) callbacks.onFailed(cameraFailureOf(error));
  });

  return {
    pause() {
      paused = true;
      if (camera?.track) camera.track.enabled = false;
      video.pause();
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (camera?.track) camera.track.enabled = true;
      // Autoplay rules can refuse play() without a gesture; the track keeps
      // its frames and the next play succeeds.
      video.play().catch(() => {});
    },
    stop() {
      if (!active) return;
      active = false;
      camera?.track?.removeEventListener('ended', onEnded);
      camera?.release();
      camera = null;
    },
  };
};
