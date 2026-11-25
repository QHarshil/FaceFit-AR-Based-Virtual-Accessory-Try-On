// Module worker entry: runs FaceLandmarker off the main thread.
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarkerService } from './landmarkerService';
import { LUMINANCE_SAMPLE_SIZE, meanLuma } from './luminance';
import { transferablesOf, type WorkerResponse } from './protocol';
import { installSameOriginGuard } from './sameOriginGuard';

const post = (message: WorkerResponse) => {
  self.postMessage(message, { transfer: transferablesOf(message) });
};

installSameOriginGuard(self, (api, url) => {
  post({ type: 'blocked', api, url });
});

// MediaPipe's GPU delegate needs WebGL2 on an OffscreenCanvas inside a worker.
const gpuAvailable = (): boolean => {
  if (typeof OffscreenCanvas === 'undefined') return false;
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
  if (!gl) return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
};

let lumaContext: OffscreenCanvasRenderingContext2D | null | undefined;

// A 2D copy small enough that reading it back costs almost nothing.
const measureLuminance = (frame: VideoFrame): number | null => {
  if (lumaContext === undefined) {
    const { width, height } = LUMINANCE_SAMPLE_SIZE;
    lumaContext =
      typeof OffscreenCanvas === 'undefined'
        ? null
        : new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  }
  if (!lumaContext) return null;
  const { width, height } = LUMINANCE_SAMPLE_SIZE;
  lumaContext.drawImage(frame, 0, 0, width, height);
  return meanLuma(lumaContext.getImageData(0, 0, width, height).data);
};

const service = createLandmarkerService({
  createLandmarker: (fileset, options) => FaceLandmarker.createFromOptions(fileset, options),
  fetch: (input, init) => self.fetch(input, init),
  gpuAvailable,
  now: () => performance.timeOrigin + performance.now(),
  post,
  measureLuminance,
});

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  void service.handle(event.data);
});
