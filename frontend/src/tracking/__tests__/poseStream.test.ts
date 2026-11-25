import { estimateIntrinsics, type HeadPose } from '@facefit/cv';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_HORIZONTAL_FOV_DEG } from '../../geometry/headPose';
import type { LandmarkFrame } from '../../perception/types';
import { rotationFromDegrees, syntheticLandmarkFrame } from '../../test/syntheticFace';
import { DEFAULT_FACE_STATUS_OPTIONS } from '../../tryon/faceStatus';
import { createPoseStream } from '../poseStream';

const intrinsics = estimateIntrinsics({
  width: 1280,
  height: 720,
  horizontalFovDeg: DEFAULT_HORIZONTAL_FOV_DEG,
})!;
const POSE: HeadPose = { rotation: rotationFromDegrees(-4, 12, 6), translationMm: [20, -10, 600] };

const faceAt = (k: number, trackId = 1): LandmarkFrame => ({
  ...syntheticLandmarkFrame(POSE, intrinsics),
  timestampMs: k * 33,
  trackId,
});
const noFaceAt = (k: number): LandmarkFrame => ({
  timestampMs: k * 33,
  width: 1280,
  height: 720,
  landmarks: new Float32Array(0),
  faceCount: 0,
  trackId: null,
});
// The face is in view but its landmarks do not fit the face model.
const scrambledAt = (k: number): LandmarkFrame => {
  const frame = faceAt(k);
  frame.landmarks = frame.landmarks.map((value, i) => value + ((i * 7919) % 13) * 0.01);
  return frame;
};

describe('createPoseStream', () => {
  it('solves and filters each frame and gives the render loop a pose', () => {
    const stream = createPoseStream('one-euro');
    const updates = vi.fn();
    stream.onUpdate(updates);
    expect(stream.poseForRender()).toBeNull();

    for (let k = 0; k < 5; k += 1) stream.push(faceAt(k));

    expect(updates).toHaveBeenCalledTimes(5);
    expect(updates.mock.calls.at(-1)?.[0]).toMatchObject({ estimate: { trusted: true } });
    const render = stream.poseForRender();
    expect(render?.pose.translationMm[2]).toBeCloseTo(600, -1);
  });

  it('notifies React subscribers only when the coarse snapshot changes', () => {
    const stream = createPoseStream();
    const listener = vi.fn();
    stream.subscribe(listener);

    for (let k = 0; k < 60; k += 1) stream.push(faceAt(k));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(stream.getSnapshot().face.tracked).toBe(true);

    const snapshot = stream.getSnapshot();
    stream.push(faceAt(61));
    expect(stream.getSnapshot()).toBe(snapshot);
  });

  it('drops the pose when the face is lost, and the face after the debounce', () => {
    const stream = createPoseStream();
    stream.push(faceAt(0));
    stream.push(noFaceAt(1));
    expect(stream.poseForRender()).toBeNull();
    expect(stream.getSnapshot().face.tracked).toBe(true);
    for (let k = 2; k <= DEFAULT_FACE_STATUS_OPTIONS.lostAfterFrames; k += 1) {
      stream.push(noFaceAt(k));
    }
    expect(stream.getSnapshot().face.tracked).toBe(false);
  });

  it('reports the pose hidden while the gate rejects a face in view', () => {
    const stream = createPoseStream();
    stream.push(faceAt(0));
    for (let k = 1; k < DEFAULT_FACE_STATUS_OPTIONS.lostAfterFrames; k += 1) {
      stream.push(scrambledAt(k));
    }
    expect(stream.getSnapshot().poseShown).toBe(true);
    stream.push(scrambledAt(DEFAULT_FACE_STATUS_OPTIONS.lostAfterFrames));
    expect(stream.getSnapshot().poseShown).toBe(false);
    stream.push(faceAt(20));
    expect(stream.getSnapshot().poseShown).toBe(true);
  });

  it('restarts the filter for a new tracked face', () => {
    const stream = createPoseStream('one-euro');
    for (let k = 0; k < 5; k += 1) stream.push(faceAt(k, 1));
    const moved: HeadPose = { ...POSE, translationMm: [-80, -10, 600] };
    stream.push({ ...syntheticLandmarkFrame(moved, intrinsics), timestampMs: 5 * 33, trackId: 2 });
    expect(stream.poseForRender()?.pose.translationMm[0]).toBeCloseTo(-80, -1);
  });

  it('starts over on reset', () => {
    const stream = createPoseStream();
    const listener = vi.fn();
    stream.subscribe(listener);
    stream.push(faceAt(0));
    stream.reset();
    expect(stream.poseForRender()).toBeNull();
    expect(stream.getSnapshot().face.tracked).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
