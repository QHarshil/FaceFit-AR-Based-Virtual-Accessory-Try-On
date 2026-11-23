import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PerceptionError } from '../../perception/errors';
import type { FrameSourceCallbacks } from '../../perception/frameSource';
import type { LandmarkerClientOptions } from '../../perception/landmarkerClient';
import type { PerceptionDelegate } from '../../perception/types';

interface FakeCamera {
  attach: () => void;
  fail: (error: Error) => void;
  live: boolean;
}

interface FakeLandmarker {
  options: LandmarkerClientOptions;
  resolveReady: (delegate: PerceptionDelegate) => void;
  rejectReady: (error: unknown) => void;
  submit: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const cameras: FakeCamera[] = [];
const landmarkers: FakeLandmarker[] = [];
const frameSources: { callbacks: FrameSourceCallbacks; stop: ReturnType<typeof vi.fn> }[] = [];

// The real camera resolves only once getUserMedia hands over a stream.
vi.mock('../camera', () => ({
  startCamera: () =>
    new Promise<() => void>((resolve, reject) => {
      const camera: FakeCamera = {
        live: false,
        attach: () => {
          camera.live = true;
          resolve(() => {
            camera.live = false;
          });
        },
        fail: reject,
      };
      cameras.push(camera);
    }),
}));

vi.mock('../../perception/landmarkerClient', () => ({
  startLandmarker: (options: LandmarkerClientOptions) => {
    const entry = { options, submit: vi.fn(), stop: vi.fn() } as unknown as FakeLandmarker;
    const ready = new Promise<PerceptionDelegate>((resolve, reject) => {
      entry.resolveReady = resolve;
      entry.rejectReady = reject;
    });
    ready.catch(() => {});
    landmarkers.push(entry);
    return { ready, submit: entry.submit, stop: entry.stop };
  },
}));

vi.mock('../../perception/frameSource', () => ({
  startFrameSource: (_video: HTMLVideoElement, callbacks: FrameSourceCallbacks) => {
    const stop = vi.fn();
    frameSources.push({ callbacks, stop });
    return stop;
  },
}));

const { startFaceTracking } = await import('../faceTracking');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const liveStreams = () => cameras.filter((camera) => camera.live).length;
const callbacks = () => ({ onLandmarks: vi.fn(), onError: vi.fn() });

describe('startFaceTracking', () => {
  beforeEach(() => {
    cameras.length = 0;
    landmarkers.length = 0;
    frameSources.length = 0;
  });

  it('loads the model while the camera starts and points it at the versioned assets', async () => {
    const tracking = startFaceTracking(document.createElement('video'), callbacks());
    await flush();

    expect(landmarkers).toHaveLength(1);
    expect(cameras).toHaveLength(1);
    expect(landmarkers[0]?.options.assets).toEqual({
      wasmBaseUrl: `/mediapipe/tasks-vision/${__TASKS_VISION_VERSION__}`,
      modelUrl: '/mediapipe/face_landmarker/float16/1/face_landmarker.task',
    });

    // Sessions are serialized, so settle this camera before the next test.
    tracking.stop();
    cameras[0]?.attach();
    await tracking.started;
  });

  it('streams frames only once both the camera and the model are ready', async () => {
    const tracking = startFaceTracking(document.createElement('video'), callbacks());
    await flush();
    cameras[0]?.attach();
    await flush();
    expect(frameSources).toHaveLength(0);

    landmarkers[0]?.resolveReady('GPU');
    await tracking.started;
    expect(frameSources).toHaveLength(1);

    const captured = { frameId: 0, frame: {} as VideoFrame, timestampMs: 1, capturedAt: 1 };
    frameSources[0]?.callbacks.onFrame(captured);
    expect(landmarkers[0]?.submit).toHaveBeenCalledWith(captured);
  });

  it('never starts the camera when stop arrives first', async () => {
    const tracking = startFaceTracking(document.createElement('video'), callbacks());
    tracking.stop();
    await tracking.started;

    expect(cameras).toHaveLength(0);
    expect(landmarkers[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('releases the stream that arrives after stop', async () => {
    const tracking = startFaceTracking(document.createElement('video'), callbacks());
    await flush();
    expect(cameras).toHaveLength(1);

    tracking.stop();
    cameras[0]?.attach();
    await tracking.started;

    expect(liveStreams()).toBe(0);
    expect(frameSources).toHaveLength(0);
  });

  it('leaves exactly one live stream after a StrictMode double setup', async () => {
    const video = document.createElement('video');
    const first = startFaceTracking(video, callbacks());
    first.stop();
    const second = startFaceTracking(video, callbacks());
    await flush();
    cameras[0]?.attach();
    landmarkers[1]?.resolveReady('GPU');
    await second.started;

    expect(cameras).toHaveLength(1);
    expect(liveStreams()).toBe(1);

    second.stop();
    expect(liveStreams()).toBe(0);
    expect(landmarkers.map((entry) => entry.stop.mock.calls.length)).toEqual([1, 1]);
    expect(frameSources[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('holds the next camera until the previous stream has attached', async () => {
    const video = document.createElement('video');
    const first = startFaceTracking(video, callbacks());
    await flush();
    expect(cameras).toHaveLength(1);

    first.stop();
    const second = startFaceTracking(video, callbacks());
    await flush();
    expect(cameras).toHaveLength(1);

    cameras[0]?.attach();
    await first.started;
    await flush();
    expect(cameras).toHaveLength(2);
    expect(cameras[0]?.live).toBe(false);

    cameras[1]?.attach();
    landmarkers[1]?.resolveReady('CPU');
    await second.started;
    expect(liveStreams()).toBe(1);
  });

  it('rejects and releases the camera when the model cannot load', async () => {
    const tracking = startFaceTracking(document.createElement('video'), callbacks());
    await flush();
    cameras[0]?.attach();
    const error = new PerceptionError('model-fetch', 'HTTP 404');
    landmarkers[0]?.rejectReady(error);

    await expect(tracking.started).rejects.toBe(error);
    expect(liveStreams()).toBe(0);
    expect(landmarkers[0]?.stop).toHaveBeenCalled();
  });

  it('rejects and stops the worker when the camera is denied', async () => {
    const tracking = startFaceTracking(document.createElement('video'), callbacks());
    await flush();
    const denied = new DOMException('Permission denied', 'NotAllowedError');
    cameras[0]?.fail(denied);

    await expect(tracking.started).rejects.toBe(denied);
    expect(landmarkers[0]?.stop).toHaveBeenCalled();
  });

  it('stops everything and reports a worker failure after start', async () => {
    const handlers = callbacks();
    const tracking = startFaceTracking(document.createElement('video'), handlers);
    await flush();
    cameras[0]?.attach();
    landmarkers[0]?.resolveReady('GPU');
    await tracking.started;

    const crash = new PerceptionError('worker', 'crashed');
    landmarkers[0]?.options.onError(crash);

    expect(handlers.onError).toHaveBeenCalledWith(crash);
    expect(liveStreams()).toBe(0);
    expect(frameSources[0]?.stop).toHaveBeenCalled();
    expect(landmarkers[0]?.stop).toHaveBeenCalled();
  });

  it('drops landmark results that arrive after stop', () => {
    const handlers = callbacks();
    const tracking = startFaceTracking(document.createElement('video'), handlers);
    tracking.stop();

    landmarkers[0]?.options.onResult({
      timestampMs: 0,
      width: 1,
      height: 1,
      landmarks: new Float32Array(0),
      faceCount: 0,
    });
    expect(handlers.onLandmarks).not.toHaveBeenCalled();
  });
});
