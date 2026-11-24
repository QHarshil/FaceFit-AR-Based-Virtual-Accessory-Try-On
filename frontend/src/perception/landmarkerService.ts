// Worker-side message handling around MediaPipe FaceLandmarker. The model
// runtime is injected so the protocol, fallback and timestamp rules are
// testable without WASM or a GPU.
import type {
  FaceLandmarker,
  FaceLandmarkerOptions,
  FaceLandmarkerResult,
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
  detectForVideo(frame: TexImageSource, timestampMs: number): FaceLandmarkerResult;
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

export const numFacesFrom = (value: string | undefined): number => {
  const faces = Number(value);
  return Number.isInteger(faces) && faces >= 1 ? faces : 1;
};

// One face, because nothing downstream reads a second. With more than one face
// MediaPipe skips its built-in landmark smoothing and runs the face detector on
// every frame where fewer faces are tracked. The eval harness builds with
// VITE_NUM_FACES=2 to measure that cost.
export const NUM_FACES = numFacesFrom(import.meta.env.VITE_NUM_FACES);

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

// The loader is an ES module that sets `globalThis.ModuleFactory` when it is
// evaluated, and tasks-vision clears that global once a runtime is created. A
// worker evaluates a module URL only once, so importing the same URL again
// leaves the global unset. A retry imports the loader under its own URL to
// evaluate it again.
const filesetForAttempt = (
  fileset: WasmFileset,
  delegate: PerceptionDelegate,
  attempt: number,
): WasmFileset =>
  attempt === 0
    ? fileset
    : { ...fileset, wasmLoaderPath: `${fileset.wasmLoaderPath}?${delegate.toLowerCase()}` };

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Vite's dev and preview servers answer a missing file with index.html and
// status 200, so a successful response is checked for the expected format.

// A .task bundle is a zip archive. Zip readers find the end-of-central-directory
// record in the last 22 bytes plus a comment of up to 64 KiB. The pinned model
// starts with two zero bytes, so the leading signature proves nothing.
const ZIP_END_SIGNATURE = [0x50, 0x4b, 0x05, 0x06];
const ZIP_END_RECORD_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
// A module script loads only when served with a JavaScript MIME type.
const JAVASCRIPT_TYPE = /^(text|application)\/(x-)?(java|ecma)script\s*(;|$)/i;

const hasBytesAt = (bytes: Uint8Array, offset: number, expected: readonly number[]): boolean =>
  expected.every((byte, i) => bytes[offset + i] === byte);

export const isZipArchive = (bytes: Uint8Array): boolean => {
  const last = bytes.length - ZIP_END_RECORD_BYTES;
  const first = Math.max(0, last - ZIP_MAX_COMMENT_BYTES);
  for (let offset = last; offset >= first; offset -= 1) {
    if (hasBytesAt(bytes, offset, ZIP_END_SIGNATURE)) return true;
  }
  return false;
};

const contentTypeOf = (response: Response): string =>
  response.headers.get('content-type') ?? 'no content type';

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
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!isZipArchive(bytes)) {
      throw new Error(`${url} is not a model bundle (${contentTypeOf(response)})`);
    }
    return bytes;
  };

  // Run only after a delegate failed, to tell a missing WASM file apart from a
  // runtime that loaded but could not start. Requests only the binary's header.
  const wasmServed = async (fileset: WasmFileset): Promise<boolean> => {
    try {
      const [loader, binary] = await Promise.all([
        deps.fetch(fileset.wasmLoaderPath, { method: 'HEAD' }),
        deps.fetch(fileset.wasmBinaryPath, {
          headers: { Range: `bytes=0-${WASM_MAGIC.length - 1}` },
        }),
      ]);
      if (!loader.ok || !binary.ok) return false;
      if (!JAVASCRIPT_TYPE.test(loader.headers.get('content-type') ?? '')) return false;
      return hasBytesAt(new Uint8Array(await binary.arrayBuffer()), 0, WASM_MAGIC);
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
    for (const [attempt, delegate] of delegates.entries()) {
      try {
        landmarker = await deps.createLandmarker(filesetForAttempt(fileset, delegate, attempt), {
          baseOptions: { modelAssetBuffer: model, delegate },
          runningMode: 'VIDEO',
          numFaces: NUM_FACES,
        });
        state = 'ready';
        deps.post({ type: 'ready', delegate });
        return;
      } catch (error) {
        failures.push(`${delegate}: ${describeError(error)}`);
        if (failures.length === 1 && !(await wasmServed(fileset))) {
          state = 'failed';
          fail(
            'wasm-fetch',
            `${fileset.wasmLoaderPath} or ${fileset.wasmBinaryPath} is missing; ${failures[0]}`,
          );
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
