// The real actors behind the try-on statechart: browser APIs wrapped so each
// reports to the machine with events and stops when its state is left.
import type { Product } from '@facefit/contracts';
import { fromCallback, fromPromise } from 'xstate';
import { ApiError, getProductById } from '../services/apiClient';
import { startCameraSession } from '../tracking/cameraSession';
import { startPerception } from '../tracking/perceptionSession';
import { detectPhotoFace } from '../tracking/photo';
import type { LandmarkFrame } from '../perception/types';
import type { PoseStream } from '../tracking/poseStream';
import type { PauseCommand, PhotoDetection, TryOnEvent } from './machine';

export interface TryOnDeps {
  /** The page's video element; the camera and the frame capture share it. */
  video: { readonly current: HTMLVideoElement | null };
  poseStream: PoseStream;
  getProduct?: (id: number, signal: AbortSignal) => Promise<Product>;
  detectPhoto?: (photo: Blob) => Promise<LandmarkFrame>;
}

type SendBack = (event: TryOnEvent) => void;

export const createTryOnActors = ({
  video,
  poseStream,
  getProduct = getProductById,
  detectPhoto = detectPhotoFace,
}: TryOnDeps) => ({
  loadProduct: fromPromise<Product, { productId: number | null }>(({ input, signal }) =>
    input.productId === null
      ? Promise.reject(new ApiError('not_found', 'Not a product id'))
      : getProduct(input.productId, signal),
  ),

  camera: fromCallback<PauseCommand>(({ sendBack, receive }) => {
    const send: SendBack = sendBack;
    const element = video.current;
    if (!element) {
      send({ type: 'CAMERA_FAILED', failure: 'unknown' });
      return undefined;
    }
    const session = startCameraSession(element, {
      onReady: () => send({ type: 'CAMERA_READY' }),
      onFailed: (failure) => send({ type: 'CAMERA_FAILED', failure }),
      onEnded: () => send({ type: 'CAMERA_ENDED' }),
    });
    receive((command) => {
      if (command.type === 'PAUSE') session.pause();
      else session.resume();
    });
    return session.stop;
  }),

  perception: fromCallback<PauseCommand>(({ sendBack, receive }) => {
    const send: SendBack = sendBack;
    const element = video.current;
    if (!element) {
      send({ type: 'PERCEPTION_FAILED', failure: 'capture_unsupported' });
      return undefined;
    }
    const session = startPerception(element, poseStream, {
      onReady: () => send({ type: 'PERCEPTION_READY' }),
      onFailed: (failure) => send({ type: 'PERCEPTION_FAILED', failure }),
      onFaceStatus: (status) => send({ type: 'FACE_STATUS', status }),
    });
    receive((command) => {
      if (command.type === 'PAUSE') session.pause();
      else session.resume();
    });
    return session.stop;
  }),

  pageVisibility: fromCallback(({ sendBack }) => {
    const send: SendBack = sendBack;
    const report = () => send({ type: document.hidden ? 'PAGE_HIDDEN' : 'PAGE_VISIBLE' });
    if (document.hidden) report();
    document.addEventListener('visibilitychange', report);
    return () => {
      document.removeEventListener('visibilitychange', report);
    };
  }),

  deviceWatcher: fromCallback(({ sendBack }) => {
    const send: SendBack = sendBack;
    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (typeof devices?.addEventListener !== 'function') return undefined;
    const onChange = () => send({ type: 'DEVICE_CHANGE' });
    devices.addEventListener('devicechange', onChange);
    return () => {
      devices.removeEventListener('devicechange', onChange);
    };
  }),

  detectPhoto: fromPromise<PhotoDetection, { photo: Blob | null }>(async ({ input, signal }) => {
    if (!input.photo) throw new Error('No photo chosen');
    const frame = await detectPhoto(input.photo);
    // The user may have gone back to the camera while the photo was read.
    signal.throwIfAborted();
    return { faceFound: poseStream.showStill(frame) };
  }),
});
