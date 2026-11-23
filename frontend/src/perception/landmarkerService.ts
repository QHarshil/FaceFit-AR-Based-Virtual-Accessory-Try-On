// Worker-side message handling around MediaPipe FaceLandmarker. The model
// runtime is injected so the protocol, fallback and timestamp rules are
// testable without WASM or a GPU.
import type {
  FaceLandmarker,
  FaceLandmarkerOptions,
  FaceLandmarkerResult,
  ImageSource,
} from '@mediapipe/tasks-vision';
import type {
  ErrorResponse,
  FrameRequest,
  InitRequest,
  PerceptionErrorCode,
  WorkerResponse,
} from './protocol';
import { isWorkerRequest } from './protocol';
import {
  LANDMARK_COUNT,
  LANDMARK_STRIDE,
  type LandmarkFrame,
  type PerceptionDelegate,
} from './types';

export type WasmFileset = Parameters<typeof FaceLandmarker.createFromOptions>[0];

/** The part of FaceLandmarker this service calls. */
export interface VideoLandmarker {
  detectForVideo(frame: ImageSource, timestampMs: number): FaceLandmarkerResult;
  close(): void;
}

export interface LandmarkerServiceDeps {
  createLandmarker: (
    fileset: WasmFileset,
    options: FaceLandmarkerOptions,
  ) => Promise<VideoLandmarker>;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  gpuAvailable: () => boolean;
  now: () => number;
  post: (message: WorkerResponse) => void;
}

// Two faces so a second person in view can be reported. With more than one
// face MediaPipe skips its built-in landmark smoothing and runs the face
// detector on every frame where fewer faces are tracked.
export const MAX_FACES = 2;

// MediaPipe needs strictly increasing timestamps. It converts milliseconds to
// integer microseconds, so a whole-millisecond step survives the rounding.
const MIN_TIMESTAMP_STEP_MS = 1;

const WASM_NAME = 'vision_wasm_module_internal';

export const wasmFilesetAt = (baseUrl: string): WasmFileset => {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    wasmLoaderPath: `${base}/${WASM_NAME}.js`,
    wasmBinaryPath: `${base}/${WASM_NAME}.wasm`,
  };
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const toLandmarkFrame = (
  result: FaceLandmarkerResult,
  timestampMs: number,
  width: number,
  height: number,
): LandmarkFrame => {
  const face = result.faceLandmarks[0];
  if (!face) {
    return { timestampMs, width, height, landmarks: new Float32Array(0), faceCount: 0 };
  }
  if (face.length < LANDMARK_COUNT) {
    throw new RangeError(`Expected ${LANDMARK_COUNT} landmarks, got ${face.length}`);
  }
  const landmarks = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
  for (let i = 0; i < LANDMARK_COUNT; i += 1) {
    const point = face[i] as { x: number; y: number; z: number };
    landmarks[i * LANDMARK_STRIDE] = point.x;
    landmarks[i * LANDMARK_STRIDE + 1] = point.y;
    landmarks[i * LANDMARK_STRIDE + 2] = point.z;
  }
  return { timestampMs, width, height, landmarks, faceCount: result.faceLandmarks.length };
};

export interface LandmarkerService {
  handle: (message: unknown) => Promise<void>;
}

export const createLandmarkerService = (deps: LandmarkerServiceDeps): LandmarkerService => {
  let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  let landmarker: VideoLandmarker | null = null;
  let lastGraphTimestamp = -Infinity;

  const fail = (code: PerceptionErrorCode, detail: string, frameId?: number) => {
    const message: ErrorResponse = { type: 'error', code, detail };
    if (frameId !== undefined) message.frameId = frameId;
    deps.post(message);
  };

  const fetchModel = async (url: string): Promise<Uint8Array> => {
    const response = await deps.fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return new Uint8Array(await response.arrayBuffer());
  };

  // Run only after a delegate failed, to tell a missing WASM file apart from a
  // runtime that loaded but could not start.
  const wasmReachable = async (fileset: WasmFileset): Promise<boolean> => {
    const paths = [fileset.wasmLoaderPath, fileset.wasmBinaryPath];
    try {
      const responses = await Promise.all(
        paths.map((path) => deps.fetch(path, { method: 'HEAD' })),
      );
      return responses.every((response) => response.ok);
    } catch {
      return false;
    }
  };

  const init = async ({ wasmBaseUrl, modelUrl }: InitRequest) => {
    if (state !== 'idle') return;
    state = 'loading';
    const fileset = wasmFilesetAt(wasmBaseUrl);

    let model: Uint8Array;
    try {
      model = await fetchModel(modelUrl);
    } catch (error) {
      state = 'failed';
      fail('model-fetch', describeError(error));
      return;
    }

    const delegates: PerceptionDelegate[] = deps.gpuAvailable() ? ['GPU', 'CPU'] : ['CPU'];
    const failures: string[] = [];
    for (const delegate of delegates) {
      try {
        landmarker = await deps.createLandmarker(fileset, {
          baseOptions: { modelAssetBuffer: model, delegate },
          runningMode: 'VIDEO',
          numFaces: MAX_FACES,
        });
        state = 'ready';
        deps.post({ type: 'ready', delegate });
        return;
      } catch (error) {
        failures.push(`${delegate}: ${describeError(error)}`);
        if (failures.length === 1 && !(await wasmReachable(fileset))) {
          state = 'failed';
          fail('wasm-fetch', `${fileset.wasmBinaryPath} is not reachable; ${failures[0]}`);
          return;
        }
      }
    }
    state = 'failed';
    fail('unsupported', failures.join('; '));
  };

  const detect = ({ frameId, timestampMs, frame }: FrameRequest) => {
    try {
      if (state !== 'ready' || !landmarker) {
        fail('inference', `Frame ${frameId} arrived before the model was ready`, frameId);
        return;
      }
      const graphTimestamp = Math.max(timestampMs, lastGraphTimestamp + MIN_TIMESTAMP_STEP_MS);
      lastGraphTimestamp = graphTimestamp;
      const start = deps.now();
      const result = landmarker.detectForVideo(frame, graphTimestamp);
      const inferenceMs = deps.now() - start;
      deps.post({
        type: 'result',
        frameId,
        inferenceMs,
        landmarkFrame: toLandmarkFrame(
          result,
          timestampMs,
          frame.displayWidth,
          frame.displayHeight,
        ),
      });
    } catch (error) {
      fail('inference', describeError(error), frameId);
    } finally {
      // An unclosed VideoFrame holds a camera buffer and stalls capture.
      frame.close();
    }
  };

  return {
    handle: async (message) => {
      if (!isWorkerRequest(message)) {
        fail('worker', 'Unrecognized message');
        return;
      }
      if (message.type === 'init') await init(message);
      else detect(message);
    },
  };
};
