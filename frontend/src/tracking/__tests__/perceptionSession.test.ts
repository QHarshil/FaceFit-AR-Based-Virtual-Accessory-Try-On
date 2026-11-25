import { estimateIntrinsics, type HeadPose } from '@facefit/cv';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_HORIZONTAL_FOV_DEG } from '../../geometry/headPose';
import { PerceptionError } from '../../perception/errors';
import type { CapturedFrame, FrameSourceCallbacks } from '../../perception/frameSource';
import type { LandmarkerClientOptions } from '../../perception/landmarkerClient';
import type { PerceptionDelegate } from '../../perception/types';
import { rotationFromDegrees, syntheticLandmarkFrame } from '../../test/syntheticFace';
import {
  startPerception,
  type PerceptionCallbacks,
  type PerceptionDeps,
} from '../perceptionSession';
import { createPoseStream } from '../poseStream';

interface FakeLandmarker {
  options: LandmarkerClientOptions;
  resolveReady: (delegate: PerceptionDelegate) => void;
  rejectReady: (error: unknown) => void;
  submit: Mock<(captured: CapturedFrame) => void>;
  stop: Mock<() => void>;
}

const ASSETS = { wasmBaseUrl: 'http://localhost/wasm', modelUrl: 'http://localhost/model.task' };
const intrinsics = estimateIntrinsics({
  width: 1280,
  height: 720,
  horizontalFovDeg: DEFAULT_HORIZONTAL_FOV_DEG,
})!;
const POSE: HeadPose = { rotation: rotationFromDegrees(0, 0, 0), translationMm: [0, 0, 600] };

const setup = (captureSupported = true) => {
  const landmarkers: FakeLandmarker[] = [];
  const frameSources: { callbacks: FrameSourceCallbacks; stop: Mock<() => void> }[] = [];
  const deps: PerceptionDeps = {
    assets: ASSETS,
    frameCaptureSupported: () => captureSupported,
    startFrameSource: (_video, callbacks) => {
      const stop = vi.fn<() => void>();
      frameSources.push({ callbacks, stop });
      return stop;
    },
    startLandmarker: (options) => {
      const entry = {
        options,
        submit: vi.fn<(captured: CapturedFrame) => void>(),
        stop: vi.fn<() => void>(),
      } as unknown as FakeLandmarker;
      const ready = new Promise<PerceptionDelegate>((resolve, reject) => {
        entry.resolveReady = resolve;
        entry.rejectReady = reject;
      });
      ready.catch(() => {});
      landmarkers.push(entry);
      return { ready, submit: entry.submit, detectImage: vi.fn(), stop: entry.stop };
    },
  };
  const callbacks: PerceptionCallbacks = {
    onReady: vi.fn(),
    onFailed: vi.fn(),
    onFaceStatus: vi.fn(),
  };
  const video = document.createElement('video');
  const poseStream = createPoseStream();
  const session = startPerception(video, poseStream, callbacks, deps);
  const landmarker = () => {
    const entry = landmarkers[landmarkers.length - 1];
    if (!entry) throw new Error('no landmarker');
    return entry;
  };
  return { session, callbacks, video, poseStream, landmarkers, frameSources, landmarker };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const captured = (frameId: number): CapturedFrame => ({
  frameId,
  timestampMs: frameId * 33,
  capturedAt: frameId * 33,
  frame: { close: vi.fn() } as unknown as VideoFrame,
});

describe('startPerception', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('loads the model from the given assets and captures frames once it is ready', async () => {
    const run = setup();
    expect(run.landmarker().options.assets).toEqual(ASSETS);
    expect(run.frameSources).toHaveLength(0);

    run.landmarker().resolveReady('GPU');
    await flush();
    expect(run.callbacks.onReady).toHaveBeenCalledTimes(1);
    expect(run.frameSources).toHaveLength(1);
  });

  it('marks each presented frame on the pose stream before submitting it', async () => {
    const run = setup();
    const present = vi.spyOn(run.poseStream, 'present');
    run.landmarker().resolveReady('CPU');
    await flush();

    const frame = captured(3);
    run.frameSources[0]?.callbacks.onFrame(frame);
    expect(present).toHaveBeenCalledWith(99);
    expect(run.landmarker().submit).toHaveBeenCalledWith(frame);
    expect(present.mock.invocationCallOrder[0]).toBeLessThan(
      run.landmarker().submit.mock.invocationCallOrder[0] as number,
    );
  });

  it('puts results on the pose stream and reports face status changes', async () => {
    const run = setup();
    run.landmarker().resolveReady('GPU');
    await flush();

    run
      .landmarker()
      .options.onResult({ ...syntheticLandmarkFrame(POSE, intrinsics), timestampMs: 0 });
    run
      .landmarker()
      .options.onResult({ ...syntheticLandmarkFrame(POSE, intrinsics), timestampMs: 33 });

    expect(run.poseStream.poseForRender()).not.toBeNull();
    expect(run.callbacks.onFaceStatus).toHaveBeenCalledTimes(1);
    expect(run.callbacks.onFaceStatus).toHaveBeenCalledWith({
      faces: 1,
      tracked: true,
      lowLight: false,
    });
  });

  it('restarts capture when a new stream starts playing', async () => {
    const run = setup();
    run.landmarker().resolveReady('GPU');
    await flush();
    run.video.dispatchEvent(new Event('playing'));
    expect(run.frameSources).toHaveLength(2);
    expect(run.frameSources[0]?.stop).toHaveBeenCalled();
  });

  it('stops capture while paused and resumes from no face', async () => {
    const run = setup();
    run.landmarker().resolveReady('GPU');
    await flush();
    run
      .landmarker()
      .options.onResult({ ...syntheticLandmarkFrame(POSE, intrinsics), timestampMs: 0 });

    run.session.pause();
    expect(run.frameSources[0]?.stop).toHaveBeenCalled();
    run.video.dispatchEvent(new Event('playing'));
    expect(run.frameSources).toHaveLength(1);

    run.session.resume();
    expect(run.frameSources).toHaveLength(2);
    expect(run.poseStream.getSnapshot().face.tracked).toBe(false);
    run
      .landmarker()
      .options.onResult({ ...syntheticLandmarkFrame(POSE, intrinsics), timestampMs: 66 });
    expect(run.callbacks.onFaceStatus).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['model-fetch', 'model_fetch'],
    ['wasm-fetch', 'wasm_fetch'],
    ['unsupported', 'unsupported'],
    ['worker', 'crashed'],
  ] as const)('reports a %s start failure as %s and stops the worker', async (code, failure) => {
    const run = setup();
    run.landmarker().rejectReady(new PerceptionError(code, 'detail'));
    await flush();
    expect(run.callbacks.onFailed).toHaveBeenCalledWith(failure);
    expect(run.landmarker().stop).toHaveBeenCalled();
    expect(run.frameSources).toHaveLength(0);
  });

  it('reports a worker crash after start once and drops later results', async () => {
    const run = setup();
    run.landmarker().resolveReady('GPU');
    await flush();
    run.landmarker().options.onError(new PerceptionError('inference', 'context lost'));
    run.landmarker().options.onError(new PerceptionError('inference', 'again'));
    expect(run.callbacks.onFailed).toHaveBeenCalledTimes(1);
    expect(run.callbacks.onFailed).toHaveBeenCalledWith('crashed');
    expect(run.frameSources[0]?.stop).toHaveBeenCalled();

    run
      .landmarker()
      .options.onResult({ ...syntheticLandmarkFrame(POSE, intrinsics), timestampMs: 0 });
    expect(run.poseStream.poseForRender()).toBeNull();
  });

  it('reports capture as unsupported without starting a worker', async () => {
    const run = setup(false);
    await flush();
    expect(run.callbacks.onFailed).toHaveBeenCalledWith('capture_unsupported');
    expect(run.landmarkers).toHaveLength(0);
  });

  it('reports a frame capture failure as capture unsupported', async () => {
    const run = setup();
    run.landmarker().resolveReady('GPU');
    await flush();
    run.frameSources[0]?.callbacks.onError(new PerceptionError('unsupported', 'VideoFrame failed'));
    expect(run.callbacks.onFailed).toHaveBeenCalledWith('capture_unsupported');
  });

  it('does nothing after stop', async () => {
    const run = setup();
    run.session.stop();
    run.landmarker().resolveReady('GPU');
    await flush();
    expect(run.callbacks.onReady).not.toHaveBeenCalled();
    expect(run.frameSources).toHaveLength(0);
    expect(run.landmarker().stop).toHaveBeenCalled();
  });
});
