import { angleBetweenRotations, estimateIntrinsics, type HeadPose } from '@facefit/cv';
import { describe, expect, it, vi } from 'vitest';
import { PerceptionError } from '../../perception/errors';
import type { LandmarkerClientOptions } from '../../perception/landmarkerClient';
import type { LandmarkFrame } from '../../perception/types';
import { DEFAULT_HORIZONTAL_FOV_DEG } from '../../geometry/headPose';
import {
  rotationFromDegrees,
  seededGaussian,
  syntheticLandmarkFrame,
} from '../../test/syntheticFace';
import { detectPhotoFace, MAX_PHOTO_SIDE, scaledSize, type PhotoDeps } from '../photo';
import { createPoseStream } from '../poseStream';

const bitmap = (width = 800, height = 600) => {
  const close = vi.fn<() => void>();
  return { image: { width, height, close } as unknown as ImageBitmap, close };
};

const fakeClient = (outcome: { ready: Promise<'GPU'>; frame?: LandmarkFrame }) => {
  const calls: LandmarkerClientOptions[] = [];
  const client = {
    ready: outcome.ready,
    submit: vi.fn(),
    detectImage: vi.fn(() => Promise.resolve(outcome.frame as LandmarkFrame)),
    stop: vi.fn(),
  };
  outcome.ready.catch(() => {});
  const deps: PhotoDeps = {
    decode: vi.fn(() => Promise.resolve(image.image)),
    startLandmarker: (options) => {
      calls.push(options);
      return client;
    },
  };
  const image = bitmap();
  return { deps, client, calls, image: image.image, closeImage: image.close };
};

describe('scaledSize', () => {
  it('keeps a photo within MAX_PHOTO_SIDE and keeps its aspect ratio', () => {
    expect(scaledSize(4032, 3024)).toEqual({ width: MAX_PHOTO_SIDE, height: 960 });
    expect(scaledSize(3024, 4032)).toEqual({ width: 960, height: MAX_PHOTO_SIDE });
    expect(scaledSize(640, 480)).toEqual({ width: 640, height: 480 });
  });
});

describe('detectPhotoFace', () => {
  const FRAME: LandmarkFrame = {
    timestampMs: 0,
    width: 800,
    height: 600,
    landmarks: new Float32Array(0),
    faceCount: 0,
    trackId: null,
  };

  it('runs FaceLandmarker in IMAGE mode on the decoded photo and stops the worker', async () => {
    const run = fakeClient({ ready: Promise.resolve('GPU'), frame: FRAME });
    const photo = new Blob(['jpeg']);

    await expect(detectPhotoFace(photo, run.deps)).resolves.toBe(FRAME);

    expect(run.deps.decode).toHaveBeenCalledWith(photo);
    expect(run.calls[0]?.runningMode).toBe('IMAGE');
    expect(run.client.detectImage).toHaveBeenCalledWith(run.image);
    expect(run.client.stop).toHaveBeenCalled();
  });

  it('releases the photo and the worker when the model cannot load', async () => {
    const run = fakeClient({ ready: Promise.reject(new PerceptionError('model-fetch', '404')) });

    await expect(detectPhotoFace(new Blob(['jpeg']), run.deps)).rejects.toBeInstanceOf(
      PerceptionError,
    );
    expect(run.closeImage).toHaveBeenCalled();
    expect(run.client.stop).toHaveBeenCalled();
    expect(run.client.detectImage).not.toHaveBeenCalled();
  });

  it('rejects a file that does not decode, before starting a worker', async () => {
    const run = fakeClient({ ready: Promise.resolve('GPU') });
    run.deps.decode = () => Promise.reject(new DOMException('bad image', 'InvalidStateError'));
    await expect(detectPhotoFace(new Blob(['text']), run.deps)).rejects.toThrow('bad image');
    expect(run.calls).toHaveLength(0);
  });
});

describe('photo pose', () => {
  // A still photo is solved with the same geometry as a camera frame, at the
  // photo's own size.
  const photoIntrinsics = estimateIntrinsics({
    width: 960,
    height: 1280,
    horizontalFovDeg: DEFAULT_HORIZONTAL_FOV_DEG,
  })!;

  // Accuracy over fields of view is in geometry/__tests__/stillPose.test.ts.
  it('draws the pose solved for the photo, unfiltered', () => {
    const truth: HeadPose = {
      rotation: rotationFromDegrees(-6, 15, 4),
      translationMm: [30, -20, 650],
    };
    const stream = createPoseStream('one-euro');
    const frame = syntheticLandmarkFrame(truth, photoIntrinsics, {
      sigmaPx: 0.6,
      gaussian: seededGaussian(7),
    });

    expect(stream.showStill(frame)).toBe(true);
    const pose = stream.poseForRender()?.pose;
    expect(pose).toBeDefined();
    if (!pose) return;
    expect((angleBetweenRotations(pose.rotation, truth.rotation) * 180) / Math.PI).toBeLessThan(2);
  });

  it('keeps the still pose however far the clock moves, until a live frame replaces it', () => {
    const stream = createPoseStream('one-euro');
    const truth: HeadPose = { rotation: rotationFromDegrees(0, 0, 0), translationMm: [0, 0, 500] };
    stream.showStill(syntheticLandmarkFrame(truth, photoIntrinsics));
    stream.present(60_000);
    expect(stream.poseForRender()).not.toBeNull();

    stream.push({ ...FRAME_WITHOUT_FACE, timestampMs: 60_000 });
    expect(stream.poseForRender()).toBeNull();
  });

  it('reports a photo without a face as not found and draws nothing', () => {
    const stream = createPoseStream();
    expect(stream.showStill(FRAME_WITHOUT_FACE)).toBe(false);
    expect(stream.poseForRender()).toBeNull();
  });
});

const FRAME_WITHOUT_FACE: LandmarkFrame = {
  timestampMs: 0,
  width: 960,
  height: 1280,
  landmarks: new Float32Array(0),
  faceCount: 0,
  trackId: null,
};
