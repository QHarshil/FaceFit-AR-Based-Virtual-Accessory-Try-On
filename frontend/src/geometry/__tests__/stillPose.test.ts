import {
  angleBetweenRotations,
  estimateIntrinsics,
  mat3MulVec3,
  projectPoint,
  type CameraIntrinsics,
  type HeadPose,
  type Vec3,
} from '@facefit/cv';
import { describe, expect, it } from 'vitest';
import { glassesPointInFaceModel } from '../glassesPlacement';
import { createHeadPoseTracker } from '../headPose';
import { solveStillPose, STILL_FOV_CANDIDATES_DEG } from '../stillPose';
import {
  rotationFromDegrees,
  seededGaussian,
  syntheticLandmarkFrame,
} from '../../test/syntheticFace';
import { ANCHORS } from '../../test/fixtures';

// A portrait-orientation photo, the stand-in portrait's size.
const WIDTH = 820;
const HEIGHT = 1024;

const intrinsicsAt = (horizontalFovDeg: number): CameraIntrinsics =>
  estimateIntrinsics({ width: WIDTH, height: HEIGHT, horizontalFovDeg })!;

/** Distance at which the face, about 150 mm wide, spans `widthPx` at this field of view. */
const depthFor = (intrinsics: CameraIntrinsics, widthPx: number) => (intrinsics.fx * 150) / widthPx;

const degrees = (radians: number) => (radians * 180) / Math.PI;

// Where the glasses' bridge and hinges land in the photo for a pose seen
// through given intrinsics: what the overlay draws.
const glassesPixels = (pose: HeadPose, intrinsics: CameraIntrinsics) =>
  [ANCHORS.bridgeCenter, ANCHORS.hingeLeft, ANCHORS.hingeRight].map((anchor: Vec3) => {
    const [x, y, z] = mat3MulVec3(
      pose.rotation,
      glassesPointInFaceModel(anchor, ANCHORS.bridgeCenter),
    );
    const [tx, ty, tz] = pose.translationMm;
    const pixel = projectPoint(intrinsics, [x + tx, y + ty, z + tz]);
    if (!pixel) throw new Error('behind the camera');
    return pixel;
  });

describe('solveStillPose', () => {
  it.each([20, 30, 45, 60])(
    'places the glasses where the true pose puts them for a %d degree lens',
    (trueFovDeg) => {
      const truthIntrinsics = intrinsicsAt(trueFovDeg);
      const truth: HeadPose = {
        rotation: rotationFromDegrees(-5, 12, 3),
        translationMm: [15, -40, depthFor(truthIntrinsics, 320)],
      };
      const frame = syntheticLandmarkFrame(truth, truthIntrinsics, {
        sigmaPx: 0.5,
        gaussian: seededGaussian(trueFovDeg),
      });

      const { estimate, horizontalFovDeg } = solveStillPose(frame);

      expect(estimate.trusted).toBe(true);
      if (!estimate.trusted || horizontalFovDeg === null || !estimate.intrinsics) return;
      expect(Math.abs(horizontalFovDeg - trueFovDeg)).toBeLessThanOrEqual(15);
      expect(
        degrees(angleBetweenRotations(estimate.fit.pose.rotation, truth.rotation)),
      ).toBeLessThan(4);
      const drawn = glassesPixels(estimate.fit.pose, estimate.intrinsics);
      const expected = glassesPixels(truth, truthIntrinsics);
      drawn.forEach(([x, y], i) => {
        const [ex, ey] = expected[i] as [number, number];
        // Hinge spacing is about 300 px here, so 2% of it.
        expect(Math.hypot(x - ex, y - ey)).toBeLessThan(6);
      });
    },
  );

  it.each([20, 35, 50, 65])(
    'recovers the field of view and pose of a noise-free %d degree photo',
    (trueFovDeg) => {
      const truthIntrinsics = intrinsicsAt(trueFovDeg);
      const truth: HeadPose = {
        rotation: rotationFromDegrees(4, -15, 2),
        translationMm: [-10, 20, depthFor(truthIntrinsics, 300)],
      };
      const { estimate, horizontalFovDeg } = solveStillPose(
        syntheticLandmarkFrame(truth, truthIntrinsics),
      );

      expect(horizontalFovDeg).toBe(trueFovDeg);
      if (!estimate.trusted) return;
      const [x, y, z] = estimate.fit.pose.translationMm;
      const [tx, ty, tz] = truth.translationMm;
      expect(Math.hypot(x - tx, y - ty, z - tz)).toBeLessThan(1);
      expect(
        degrees(angleBetweenRotations(estimate.fit.pose.rotation, truth.rotation)),
      ).toBeLessThan(0.1);
      // The camera's fixed field of view fits this photo worse.
      const camera = createHeadPoseTracker().update(syntheticLandmarkFrame(truth, truthIntrinsics));
      if (trueFovDeg !== 60 && camera.fit) {
        expect(camera.fit.rmsReprojectionPx).toBeGreaterThan(estimate.fit.rmsReprojectionPx);
      }
    },
  );

  it('reports no face for a frame without one', () => {
    const frame = {
      timestampMs: 0,
      width: WIDTH,
      height: HEIGHT,
      landmarks: new Float32Array(0),
      faceCount: 0,
      trackId: null,
    };
    const { estimate, horizontalFovDeg } = solveStillPose(frame);
    expect(estimate).toMatchObject({ trusted: false, reason: 'no-face' });
    expect(horizontalFovDeg).toBeNull();
  });

  it('tries fields of view on both sides of the camera default', () => {
    expect(Math.min(...STILL_FOV_CANDIDATES_DEG)).toBeLessThan(60);
    expect(Math.max(...STILL_FOV_CANDIDATES_DEG)).toBeGreaterThan(60);
  });
});
