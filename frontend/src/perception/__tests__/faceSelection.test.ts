import { estimateIntrinsics, type HeadPose } from '@facefit/cv';
import { describe, expect, it } from 'vitest';
import { rotationFromDegrees, syntheticLandmarkFrame } from '../../test/syntheticFace';
import {
  createTrackedFaceSelector,
  faceSizePx,
  MATCH_RADIUS,
  MAX_MISSED_FRAMES,
  MAX_SIZE_CHANGE,
} from '../faceSelection';
import { LANDMARK_COUNT, LANDMARK_STRIDE, type LandmarkPoint } from '../types';

const WIDTH = 1280;
const HEIGHT = 720;
const intrinsics = estimateIntrinsics({ width: WIDTH, height: HEIGHT, horizontalFovDeg: 60 })!;

/** The canonical face seen through `pose`, as the landmark list MediaPipe returns. */
const faceWithPose = (pose: HeadPose): LandmarkPoint[] => {
  const { landmarks } = syntheticLandmarkFrame(pose, intrinsics);
  return Array.from({ length: LANDMARK_COUNT }, (_, i) => ({
    x: landmarks[i * LANDMARK_STRIDE]!,
    y: landmarks[i * LANDMARK_STRIDE + 1]!,
    z: 0,
  }));
};

const poseOf = (yawDeg: number, xMm: number, zMm: number, pitchDeg = 0): HeadPose => ({
  rotation: rotationFromDegrees(pitchDeg, yawDeg, 0),
  translationMm: [xMm, 0, zMm],
});

/** A frontal face centred at (x, y) page pixels whose size is `sizePx`. */
const faceAt = (x: number, y: number, sizePx: number): LandmarkPoint[] =>
  Array.from({ length: LANDMARK_COUNT }, (_, i) => {
    const offsets: Record<number, [number, number]> = {
      33: [-sizePx / 2, 0],
      263: [sizePx / 2, 0],
      10: [0, -0.45 * sizePx],
      4: [0, 0.45 * sizePx],
    };
    const [dx, dy] = offsets[i] ?? [0, 0];
    return { x: (x + dx) / WIDTH, y: (y + dy) / HEIGHT, z: 0 };
  });

type Selector = ReturnType<typeof createTrackedFaceSelector>;
const select = (selector: Selector, faces: LandmarkPoint[][]) =>
  selector.select(faces, WIDTH, HEIGHT);

describe('faceSizePx', () => {
  const sizeAt = (yawDeg: number, pitchDeg: number) =>
    faceSizePx(faceWithPose(poseOf(yawDeg, 0, 600, pitchDeg)), WIDTH, HEIGHT)!;

  // The frontal size is the eye corner distance, 88.9 mm on the canonical
  // face. Yaw leaves the midline's 87.2 mm height and adds at most the nose
  // tip's 31 mm of depth across it, 92.6 mm at 90 degrees: -1.9% to +4.2%
  // without perspective.
  it('stays within 5% of the frontal size through 80 degrees of yaw', () => {
    const frontal = sizeAt(0, 0);
    for (let yaw = -80; yaw <= 80; yaw += 5) {
      expect(Math.abs(sizeAt(yaw, 0) / frontal - 1)).toBeLessThan(0.05);
    }
  });

  // Pitch leaves the eye corners alone, so the size does not fall below them
  // by more than perspective moves them. Pitching down turns the midline
  // across the view, at its full 92.6 mm, with its landmarks 70 mm nearer the
  // camera than the face origin: 11% larger than frontal at 20 degrees.
  it('stays between 6% below and 12% above the frontal size through 40 degrees of pitch', () => {
    const frontal = sizeAt(0, 0);
    for (let pitch = -40; pitch <= 40; pitch += 5) {
      const ratio = sizeAt(0, pitch) / frontal;
      expect(ratio).toBeGreaterThan(0.94);
      expect(ratio).toBeLessThan(1.12);
    }
  });

  it('is null for a face without the landmarks it reads', () => {
    expect(faceSizePx([], WIDTH, HEIGHT)).toBeNull();
  });
});

describe('createTrackedFaceSelector', () => {
  it('starts on the largest face whatever the order, and finds none in an empty frame', () => {
    expect(
      select(createTrackedFaceSelector(), [faceAt(300, 360, 90), faceAt(900, 360, 120)]),
    ).toEqual({ index: 1, trackId: 1 });
    expect(
      select(createTrackedFaceSelector(), [faceAt(900, 360, 120), faceAt(300, 360, 90)])?.index,
    ).toBe(0);
    expect(select(createTrackedFaceSelector(), [])).toBeNull();
  });

  it('starts on a user turned 50 degrees next to a frontal bystander at 0.8 of their size', () => {
    const user = faceWithPose(poseOf(50, 0, 600));
    const bystander = faceWithPose(poseOf(0, 260, 750));
    expect(select(createTrackedFaceSelector(), [bystander, user])?.index).toBe(1);
  });

  it('keeps a user turning to 60 degrees and back next to a frontal bystander at 0.8 of their size', () => {
    const selector = createTrackedFaceSelector();
    const bystander = faceWithPose(poseOf(0, 260, 750));
    const trackIds = new Set<number>();
    for (let k = 0; k <= 120; k++) {
      const user = faceWithPose(poseOf(60 * Math.sin((Math.PI * k) / 120), 0, 600));
      // MediaPipe's order changes from frame to frame.
      const faces = k % 2 ? [user, bystander] : [bystander, user];
      const tracked = select(selector, faces);
      expect(tracked?.index).toBe(k % 2 ? 0 : 1);
      trackIds.add(tracked!.trackId);
    }
    expect(trackIds.size).toBe(1);
  });

  it('keeps the user after one missed detection next to a bystander at 0.85 of their size', () => {
    const selector = createTrackedFaceSelector();
    const user = faceWithPose(poseOf(0, 0, 600));
    const bystander = faceWithPose(poseOf(0, 260, 706));
    const first = select(selector, [user, bystander]);
    expect(first?.index).toBe(0);
    expect(select(selector, [bystander])).toBeNull();
    for (let k = 0; k < 10; k++)
      expect(select(selector, [bystander, user])).toEqual({ index: 1, trackId: first!.trackId });
  });

  it('keeps the tracked face against a similar one, even when MediaPipe reorders them', () => {
    const selector = createTrackedFaceSelector();
    const first = select(selector, [faceAt(300, 360, 100), faceAt(900, 360, 95)]);
    expect(first?.index).toBe(0);
    // The other face jitters around the tracked one's size from frame to frame.
    for (let k = 0; k < 20; k++) {
      const other = faceAt(900 + (k % 3), 360, k % 2 ? 108 : 92);
      const tracked = faceAt(300 + (k % 2), 361, 100);
      expect(select(selector, k % 2 ? [other, tracked] : [tracked, other])).toEqual({
        index: k % 2 ? 1 : 0,
        trackId: first!.trackId,
      });
    }
  });

  it('keeps the tracked face when a larger face enters', () => {
    const selector = createTrackedFaceSelector();
    const first = select(selector, [faceAt(300, 360, 100)]);
    expect(select(selector, [faceAt(900, 360, 200), faceAt(302, 360, 100)])).toEqual({
      index: 1,
      trackId: first!.trackId,
    });
  });

  it('follows the tracked face as it moves and grows a little each frame', () => {
    const selector = createTrackedFaceSelector();
    const first = select(selector, [faceAt(300, 360, 100), faceAt(1000, 360, 95)]);
    for (let k = 1; k <= 30; k++) {
      expect(
        select(selector, [faceAt(1000, 360, 95), faceAt(300 + 15 * k, 360, 100 + 2 * k)]),
      ).toEqual({ index: 1, trackId: first!.trackId });
    }
  });

  it('treats a face past the match radius or the size change as missing', () => {
    const jumped = createTrackedFaceSelector();
    jumped.select([faceAt(300, 360, 100)], WIDTH, HEIGHT);
    expect(select(jumped, [faceAt(300 + 100 * MATCH_RADIUS + 1, 360, 100)])).toBeNull();
    const grown = createTrackedFaceSelector();
    grown.select([faceAt(300, 360, 100)], WIDTH, HEIGHT);
    expect(select(grown, [faceAt(300, 360, 100 * MAX_SIZE_CHANGE + 1)])).toBeNull();
  });

  it('moves to another face only after the tracked face is missed for more than MAX_MISSED_FRAMES', () => {
    const selector = createTrackedFaceSelector();
    const first = select(selector, [faceAt(300, 360, 120), faceAt(900, 360, 100)]);
    for (let k = 0; k < MAX_MISSED_FRAMES; k++) {
      expect(select(selector, k % 2 ? [] : [faceAt(900, 360, 100)])).toBeNull();
    }
    const next = select(selector, [faceAt(900, 360, 100)]);
    expect(next?.index).toBe(0);
    expect(next?.trackId).not.toBe(first?.trackId);
    // The returning face does not take the overlay back.
    expect(select(selector, [faceAt(300, 360, 120), faceAt(901, 360, 100)])).toEqual({
      index: 1,
      trackId: next!.trackId,
    });
  });
});
