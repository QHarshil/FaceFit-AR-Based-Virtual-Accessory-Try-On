import {
  mat3Multiply,
  mat3MulVec3,
  projectPoint,
  RIGID_FACE_LANDMARKS,
  rotationMatrixFromVector,
  type CameraIntrinsics,
  type HeadPose,
  type Mat3,
  type Vec3,
} from '@facefit/cv';
import { LANDMARK_COUNT, LANDMARK_STRIDE, type LandmarkFrame } from '../perception/types';

const DEG = Math.PI / 180;

/** Rotation built as roll * yaw * pitch about the camera axes, from degrees. */
export const rotationFromDegrees = (pitchDeg: number, yawDeg: number, rollDeg: number): Mat3 =>
  mat3Multiply(
    rotationMatrixFromVector([0, 0, rollDeg * DEG]),
    mat3Multiply(
      rotationMatrixFromVector([0, yawDeg * DEG, 0]),
      rotationMatrixFromVector([pitchDeg * DEG, 0, 0]),
    ),
  );

/** Mulberry32 with Box-Muller, so noisy trials are reproducible. */
export const seededGaussian = (seed: number) => {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (sigma: number) =>
    sigma * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
};

/**
 * A landmark frame whose rigid landmarks are the canonical face model seen
 * through `pose` and `intrinsics`, with optional Gaussian pixel noise. Other
 * landmarks sit at the image centre; the solver does not read them.
 */
export const syntheticLandmarkFrame = (
  pose: HeadPose,
  intrinsics: CameraIntrinsics,
  noise: { sigmaPx: number; gaussian: (sigma: number) => number } | null = null,
): LandmarkFrame => {
  const landmarks = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
  for (let i = 0; i < LANDMARK_COUNT; i += 1) {
    landmarks[i * LANDMARK_STRIDE] = 0.5;
    landmarks[i * LANDMARK_STRIDE + 1] = 0.5;
  }
  for (const { landmarkIndex, positionMm } of RIGID_FACE_LANDMARKS) {
    const camera = add(mat3MulVec3(pose.rotation, positionMm), pose.translationMm);
    const pixel = projectPoint(intrinsics, camera);
    if (!pixel) throw new Error(`landmark ${landmarkIndex} is behind the camera`);
    const du = noise ? noise.gaussian(noise.sigmaPx) : 0;
    const dv = noise ? noise.gaussian(noise.sigmaPx) : 0;
    landmarks[landmarkIndex * LANDMARK_STRIDE] = (pixel[0] + du) / intrinsics.width;
    landmarks[landmarkIndex * LANDMARK_STRIDE + 1] = (pixel[1] + dv) / intrinsics.height;
  }
  return {
    timestampMs: 0,
    width: intrinsics.width,
    height: intrinsics.height,
    landmarks,
    faceCount: 1,
    trackId: 1,
  };
};

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
