// Module worker entry: runs FaceLandmarker off the main thread.
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarkerService } from './landmarkerService';
import { transferablesOf } from './protocol';
import { sameOriginFetch } from './sameOriginFetch';

const nativeFetch = self.fetch.bind(self);
self.fetch = sameOriginFetch(nativeFetch, self.location.origin);

// MediaPipe's GPU delegate needs WebGL2 on an OffscreenCanvas inside a worker.
const gpuAvailable = (): boolean => {
  if (typeof OffscreenCanvas === 'undefined') return false;
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
  if (!gl) return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
};

const service = createLandmarkerService({
  createLandmarker: (fileset, options) => FaceLandmarker.createFromOptions(fileset, options),
  fetch: (input, init) => self.fetch(input, init),
  gpuAvailable,
  now: () => performance.now(),
  post: (message) => {
    self.postMessage(message, { transfer: transferablesOf(message) });
  },
});

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  void service.handle(event.data);
});
