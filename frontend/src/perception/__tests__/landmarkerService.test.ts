import type { FaceLandmarkerOptions, FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_FACES,
  createLandmarkerService,
  toLandmarkFrame,
  wasmFilesetAt,
  type LandmarkerServiceDeps,
  type VideoLandmarker,
  type WasmFileset,
} from '../landmarkerService';
import type { WorkerResponse } from '../protocol';
import { LANDMARK_COUNT } from '../types';

const MODEL_BYTES = new Uint8Array([1, 2, 3, 4]);
const INIT = { type: 'init', wasmBaseUrl: '/mediapipe/tasks-vision/1.2.3/', modelUrl: '/m.task' };

const face = (offset: number) =>
  Array.from({ length: LANDMARK_COUNT }, (_, i) => ({
    x: offset + i,
    y: offset + i + 0.25,
    z: offset + i + 0.5,
    visibility: 0,
  }));

const resultWith = (faces: number): FaceLandmarkerResult => ({
  faceLandmarks: Array.from({ length: faces }, (_, i) => face(i * 1000)),
  faceBlendshapes: [],
  facialTransformationMatrixes: [],
});

const videoFrame = () => ({ displayWidth: 640, displayHeight: 480, close: vi.fn() });

const okResponse = (body = MODEL_BYTES) => new Response(body.slice(), { status: 200 });

interface Harness {
  deps: LandmarkerServiceDeps;
  posted: WorkerResponse[];
  options: FaceLandmarkerOptions[];
  landmarker: VideoLandmarker & { detectForVideo: ReturnType<typeof vi.fn> };
}

const harness = (overrides: Partial<LandmarkerServiceDeps> = {}): Harness => {
  const posted: WorkerResponse[] = [];
  const options: FaceLandmarkerOptions[] = [];
  const landmarker = {
    detectForVideo: vi.fn(() => resultWith(1)),
    close: vi.fn(),
  };
  let clock = 0;
  const deps: LandmarkerServiceDeps = {
    createLandmarker: vi.fn((_fileset, opts: FaceLandmarkerOptions) => {
      options.push(opts);
      return Promise.resolve(landmarker);
    }),
    fetch: vi.fn(() => Promise.resolve(okResponse())),
    gpuAvailable: () => true,
    now: () => {
      clock += 2.5;
      return clock;
    },
    post: (message) => posted.push(message),
    ...overrides,
  };
  return { deps, posted, options, landmarker };
};

describe('landmarker service init', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('starts FaceLandmarker in VIDEO mode on the GPU with the fetched model', async () => {
    await createLandmarkerService(h.deps).handle(INIT);

    expect(h.deps.fetch).toHaveBeenCalledWith('/m.task');
    expect(h.deps.createLandmarker).toHaveBeenCalledWith(
      {
        wasmLoaderPath: '/mediapipe/tasks-vision/1.2.3/vision_wasm_module_internal.js',
        wasmBinaryPath: '/mediapipe/tasks-vision/1.2.3/vision_wasm_module_internal.wasm',
      },
      expect.anything(),
    );
    expect(h.options[0]).toMatchObject({
      runningMode: 'VIDEO',
      numFaces: MAX_FACES,
      baseOptions: { delegate: 'GPU' },
    });
    expect(h.options[0]?.baseOptions?.modelAssetBuffer).toEqual(MODEL_BYTES);
    expect(h.posted).toEqual([{ type: 'ready', delegate: 'GPU' }]);
  });

  it('falls back to the CPU when the GPU delegate fails to start', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('WebGL context lost'))
      .mockResolvedValueOnce(h.landmarker);
    h = harness({ createLandmarker: create });

    await createLandmarkerService(h.deps).handle(INIT);

    expect(
      create.mock.calls.map(([, opts]) => (opts as FaceLandmarkerOptions).baseOptions?.delegate),
    ).toEqual(['GPU', 'CPU']);
    expect(h.posted).toEqual([{ type: 'ready', delegate: 'CPU' }]);
  });

  it('loads the WASM loader under a new URL for the CPU attempt and keeps the binary', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('StartGraph failed'))
      .mockResolvedValueOnce(h.landmarker);
    h = harness({ createLandmarker: create });

    await createLandmarkerService(h.deps).handle(INIT);

    const [gpu, cpu] = create.mock.calls.map(([fileset]) => fileset as WasmFileset);
    expect(cpu?.wasmLoaderPath).not.toBe(gpu?.wasmLoaderPath);
    expect(cpu?.wasmLoaderPath).toMatch(/^\/mediapipe\/tasks-vision\/1\.2\.3\/.*\.js\?/);
    expect(cpu?.wasmBinaryPath).toBe(gpu?.wasmBinaryPath);
  });

  it('uses the plain loader URL when the CPU is the only attempt', async () => {
    h = harness({ gpuAvailable: () => false });
    await createLandmarkerService(h.deps).handle(INIT);

    expect(h.deps.createLandmarker).toHaveBeenCalledWith(
      wasmFilesetAt(INIT.wasmBaseUrl),
      expect.anything(),
    );
  });

  it('goes straight to the CPU when no WebGL2 worker context exists', async () => {
    h = harness({ gpuAvailable: () => false });
    await createLandmarkerService(h.deps).handle(INIT);

    expect(h.options.map((opts) => opts.baseOptions?.delegate)).toEqual(['CPU']);
    expect(h.posted).toEqual([{ type: 'ready', delegate: 'CPU' }]);
  });

  it('reports a model fetch failure without loading the runtime', async () => {
    h = harness({ fetch: vi.fn(() => Promise.resolve(new Response('', { status: 404 }))) });
    await createLandmarkerService(h.deps).handle(INIT);

    expect(h.deps.createLandmarker).not.toHaveBeenCalled();
    expect(h.posted).toEqual([
      { type: 'error', code: 'model-fetch', detail: 'HTTP 404 for /m.task' },
    ]);
  });

  it('reports a network error on the model as a model fetch failure', async () => {
    h = harness({ fetch: vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) });
    await createLandmarkerService(h.deps).handle(INIT);

    expect(h.posted).toEqual([{ type: 'error', code: 'model-fetch', detail: 'Failed to fetch' }]);
  });

  it('reports a missing WASM file instead of retrying on the CPU', async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'HEAD' ? new Response(null, { status: 404 }) : okResponse()),
    );
    const create = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'));
    h = harness({ fetch, createLandmarker: create });

    await createLandmarkerService(h.deps).handle(INIT);

    expect(create).toHaveBeenCalledTimes(1);
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0]).toMatchObject({ type: 'error', code: 'wasm-fetch' });
  });

  it('reports unsupported when both delegates fail with the WASM reachable', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('gpu init'))
      .mockRejectedValueOnce(new Error('cpu init'));
    h = harness({ createLandmarker: create });

    await createLandmarkerService(h.deps).handle(INIT);

    expect(h.posted).toEqual([
      { type: 'error', code: 'unsupported', detail: 'GPU: gpu init; CPU: cpu init' },
    ]);
  });

  it('ignores a second init', async () => {
    const service = createLandmarkerService(h.deps);
    await service.handle(INIT);
    await service.handle(INIT);

    expect(h.deps.createLandmarker).toHaveBeenCalledTimes(1);
    expect(h.posted).toHaveLength(1);
  });

  it('rejects messages outside the protocol', async () => {
    await createLandmarkerService(h.deps).handle({ type: 'close' });
    expect(h.posted).toEqual([{ type: 'error', code: 'worker', detail: 'Unrecognized message' }]);
  });
});

describe('landmarker service frames', () => {
  const ready = async (h: Harness) => {
    const service = createLandmarkerService(h.deps);
    await service.handle(INIT);
    h.posted.length = 0;
    return service;
  };

  it('returns the first face interleaved, the face count and the worker inference time', async () => {
    const h = harness();
    h.landmarker.detectForVideo.mockReturnValue(resultWith(2));
    const service = await ready(h);
    const frame = videoFrame();

    await service.handle({ type: 'frame', frameId: 7, timestampMs: 1000.5, frame });

    const message = h.posted[0];
    expect(message?.type).toBe('result');
    if (message?.type !== 'result') return;
    expect(message.frameId).toBe(7);
    expect(message.inferenceMs).toBe(2.5);
    const { landmarkFrame } = message;
    expect(landmarkFrame).toMatchObject({
      timestampMs: 1000.5,
      width: 640,
      height: 480,
      faceCount: 2,
    });
    expect(Array.from(landmarkFrame.landmarks.slice(0, 6))).toEqual([0, 0.25, 0.5, 1, 1.25, 1.5]);
    expect(landmarkFrame.landmarks[477 * 3]).toBe(477);
    expect(frame.close).toHaveBeenCalledTimes(1);
  });

  it('feeds MediaPipe strictly increasing timestamps and reports the capture time unchanged', async () => {
    const h = harness();
    const service = await ready(h);

    for (const [frameId, timestampMs] of [
      [1, 100],
      [2, 100],
      [3, 99.5],
      [4, 133.4],
    ] as const) {
      await service.handle({ type: 'frame', frameId, timestampMs, frame: videoFrame() });
    }

    const graphTimestamps = h.landmarker.detectForVideo.mock.calls.map(([, ts]) => ts as number);
    expect(graphTimestamps).toEqual([100, 101, 102, 133.4]);
    const reported = h.posted.map((m) =>
      m.type === 'result' ? m.landmarkFrame.timestampMs : null,
    );
    expect(reported).toEqual([100, 100, 99.5, 133.4]);
  });

  it('reports an empty frame when no face is found', async () => {
    const h = harness();
    h.landmarker.detectForVideo.mockReturnValue(resultWith(0));
    const service = await ready(h);

    await service.handle({ type: 'frame', frameId: 1, timestampMs: 5, frame: videoFrame() });

    expect(h.posted[0]).toMatchObject({ type: 'result', landmarkFrame: { faceCount: 0 } });
  });

  it('reports an inference error for the frame and still closes it', async () => {
    const h = harness();
    h.landmarker.detectForVideo.mockImplementation(() => {
      throw new Error('graph failed');
    });
    const service = await ready(h);
    const frame = videoFrame();

    await service.handle({ type: 'frame', frameId: 4, timestampMs: 5, frame });

    expect(h.posted).toEqual([
      { type: 'error', code: 'inference', detail: 'graph failed', frameId: 4 },
    ]);
    expect(frame.close).toHaveBeenCalledTimes(1);
  });

  it('closes and rejects a frame that arrives before the model is ready', async () => {
    const h = harness();
    const frame = videoFrame();

    await createLandmarkerService(h.deps).handle({
      type: 'frame',
      frameId: 0,
      timestampMs: 1,
      frame,
    });

    expect(h.posted[0]).toMatchObject({ type: 'error', code: 'inference', frameId: 0 });
    expect(frame.close).toHaveBeenCalledTimes(1);
  });
});

describe('helpers', () => {
  it('builds the module WASM paths without doubling slashes', () => {
    expect(wasmFilesetAt('/w/')).toEqual(wasmFilesetAt('/w'));
  });

  it('rejects a face with fewer landmarks than the refined mesh', () => {
    const short = { ...resultWith(1), faceLandmarks: [face(0).slice(0, 468)] };
    expect(() => toLandmarkFrame(short, 0, 1, 1)).toThrow(RangeError);
  });
});
