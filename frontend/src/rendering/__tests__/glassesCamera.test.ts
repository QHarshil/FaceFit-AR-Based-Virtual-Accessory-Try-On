import {
  estimateIntrinsics,
  mat3MulVec3,
  projectPoint,
  RIGID_FACE_LANDMARKS,
  type CameraIntrinsics,
  type HeadPose,
  type Vec2,
  type Vec3,
} from '@facefit/cv';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { coverFit, sourceToBox } from '../../geometry/coverFit';
import {
  BRIDGE_FORWARD_OFFSET_MM,
  CANONICAL_NOSE_BRIDGE_MM,
  glassesTransform,
} from '../../geometry/glassesPlacement';
import { ANCHORS } from '../../test/fixtures';
import { rotationFromDegrees, syntheticLandmarkFrame } from '../../test/syntheticFace';
import { applyIntrinsics, applyTransform, eyeToVideoPixel } from '../glassesCamera';

const SEAT: Vec3 = [
  CANONICAL_NOSE_BRIDGE_MM[0],
  CANONICAL_NOSE_BRIDGE_MM[1],
  CANONICAL_NOSE_BRIDGE_MM[2] - BRIDGE_FORWARD_OFFSET_MM,
];

/** Where the solver's camera images a glasses point seated on the face: R (seat + H (p - b)) + t. */
const expectedPixel = (intrinsics: CameraIntrinsics, pose: HeadPose, point: Vec3): Vec2 => {
  const b = ANCHORS.bridgeCenter;
  const face: Vec3 = [
    SEAT[0] + (point[0] - b[0]),
    SEAT[1] - (point[1] - b[1]),
    SEAT[2] - (point[2] - b[2]),
  ];
  const camera = mat3MulVec3(pose.rotation, face);
  const pixel = projectPoint(intrinsics, [
    camera[0] + pose.translationMm[0],
    camera[1] + pose.translationMm[1],
    camera[2] + pose.translationMm[2],
  ]);
  if (!pixel) throw new Error('point is behind the camera');
  return pixel;
};

/** Renders a model point through the Three.js scene graph and camera. */
const renderedPixel = (intrinsics: CameraIntrinsics, pose: HeadPose, point: Vec3): Vec2 => {
  const camera = new THREE.Camera();
  expect(applyIntrinsics(camera, intrinsics)).toBe(true);
  const glasses = new THREE.Group();
  applyTransform(glasses, glassesTransform(pose, ANCHORS.bridgeCenter));
  const world = glasses.localToWorld(new THREE.Vector3(...point));
  return eyeToVideoPixel(camera, intrinsics, [world.x, world.y, world.z]);
};

const OFF_CENTRE: CameraIntrinsics = {
  fx: 1000,
  fy: 1010,
  cx: 610,
  cy: 380,
  width: 1280,
  height: 720,
};

describe('glasses camera', () => {
  it.each([
    {
      name: '1280x720, frontal',
      intrinsics: estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 })!,
      angles: [0, 0, 0],
      at: [0, 0, 600],
    },
    {
      name: '1280x720, turned',
      intrinsics: estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 })!,
      angles: [-10, 30, 15],
      at: [-80, 40, 500],
    },
    {
      name: '640x480',
      intrinsics: estimateIntrinsics({ width: 640, height: 480, horizontalFovDeg: 70 })!,
      angles: [12, -20, -6],
      at: [40, -30, 450],
    },
    {
      name: 'portrait',
      intrinsics: estimateIntrinsics({ width: 720, height: 1280, horizontalFovDeg: 50 })!,
      angles: [5, 10, 20],
      at: [0, 60, 650],
    },
    {
      name: 'off-centre principal point',
      intrinsics: OFF_CENTRE,
      angles: [8, -15, 4],
      at: [20, 10, 550],
    },
  ])('renders every anchor on its pixel ($name)', ({ intrinsics, angles, at }) => {
    const pose: HeadPose = {
      rotation: rotationFromDegrees(angles[0] as number, angles[1] as number, angles[2] as number),
      translationMm: [at[0] as number, at[1] as number, at[2] as number],
    };
    const { bridgeCenter, nosePadLeft, nosePadRight, hingeLeft, hingeRight } = ANCHORS;
    for (const anchor of [bridgeCenter, nosePadLeft, nosePadRight, hingeLeft, hingeRight]) {
      const rendered = renderedPixel(intrinsics, pose, anchor);
      const expected = expectedPixel(intrinsics, pose, anchor);
      // Float32 matrices in Three.js leave about 1e-4 px at these depths.
      expect(rendered[0]).toBeCloseTo(expected[0], 3);
      expect(rendered[1]).toBeCloseTo(expected[1], 3);
    }
  });

  it('rejects intrinsics the projection cannot use', () => {
    const camera = new THREE.Camera();
    const before = camera.projectionMatrix.clone();
    expect(applyIntrinsics(camera, { ...OFF_CENTRE, fx: 0 })).toBe(false);
    expect(camera.projectionMatrix.equals(before)).toBe(true);
  });

  // The canvas renders at the video's intrinsic size and both use object-fit:
  // cover, so a glasses point placed on a face landmark must reach the page
  // pixel where the video shows that landmark.
  it.each([
    { page: { width: 1280, height: 720 } },
    { page: { width: 1600, height: 600 } },
    { page: { width: 390, height: 844 } },
    { page: { width: 1024, height: 1024 } },
  ])(
    'lands on the video landmark under object-fit: cover in a $page.width x $page.height page',
    ({ page }) => {
      const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 })!;
      const pose: HeadPose = {
        rotation: rotationFromDegrees(-5, 15, 8),
        translationMm: [-30, 20, 550],
      };
      const frame = syntheticLandmarkFrame(pose, intrinsics);
      const fit = coverFit(intrinsics, page)!;
      for (const { landmarkIndex, positionMm } of RIGID_FACE_LANDMARKS.slice(0, 8)) {
        const glassesPoint: Vec3 = [
          positionMm[0] - SEAT[0],
          -(positionMm[1] - SEAT[1]),
          -(positionMm[2] - SEAT[2]),
        ];
        const rendered = sourceToBox(fit, renderedPixel(intrinsics, pose, glassesPoint));
        const offset = landmarkIndex * 3;
        const video = sourceToBox(fit, [
          (frame.landmarks[offset] as number) * intrinsics.width,
          (frame.landmarks[offset + 1] as number) * intrinsics.height,
        ]);
        expect(rendered[0]).toBeCloseTo(video[0], 2);
        expect(rendered[1]).toBeCloseTo(video[1], 2);
      }
    },
  );
});
