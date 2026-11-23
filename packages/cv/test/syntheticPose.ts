import type { CameraIntrinsics } from '../src/camera.ts';
import { projectPoint } from '../src/camera.ts';
import { mat3Multiply, mat3MulVec3, type Vec2 } from '../src/linalg.ts';
import type { HeadPose, WeightedModelPoint } from '../src/pnp.ts';
import { rotationMatrixFromVector } from '../src/rotation.ts';
import type { SeededRandom } from './random.ts';

const DEG = Math.PI / 180;

export const POSE_RANGE = {
  yawDeg: 45,
  pitchDeg: 30,
  rollDeg: 30,
  minDistanceMm: 350,
  maxDistanceMm: 900,
};

/**
 * Random head pose within POSE_RANGE. The three angles only sample the test
 * distribution; the rotation is built once as roll * yaw * pitch about the
 * camera axes and never decomposed back. The model origin lands in the
 * central half of the image at a depth between the distance limits.
 */
export function sampleHeadPose(random: SeededRandom, intrinsics: CameraIntrinsics): HeadPose {
  const yaw = rotationMatrixFromVector([0, random.uniform(-1, 1) * POSE_RANGE.yawDeg * DEG, 0]);
  const pitch = rotationMatrixFromVector([random.uniform(-1, 1) * POSE_RANGE.pitchDeg * DEG, 0, 0]);
  const roll = rotationMatrixFromVector([0, 0, random.uniform(-1, 1) * POSE_RANGE.rollDeg * DEG]);
  const depth = random.uniform(POSE_RANGE.minDistanceMm, POSE_RANGE.maxDistanceMm);
  const u = random.uniform(0.25, 0.75) * intrinsics.width;
  const v = random.uniform(0.25, 0.75) * intrinsics.height;
  return {
    rotation: mat3Multiply(roll, mat3Multiply(yaw, pitch)),
    translationMm: [
      ((u - intrinsics.cx) * depth) / intrinsics.fx,
      ((v - intrinsics.cy) * depth) / intrinsics.fy,
      depth,
    ],
  };
}

/** Projects every model point through the pose and adds isotropic Gaussian pixel noise. */
export function projectWithNoise(
  pose: HeadPose,
  modelPoints: readonly WeightedModelPoint[],
  intrinsics: CameraIntrinsics,
  sigmaPx: number,
  random: SeededRandom,
): Vec2[] {
  return modelPoints.map((point) => {
    const camera = mat3MulVec3(pose.rotation, point.positionMm);
    const pixel = projectPoint(intrinsics, [
      camera[0] + pose.translationMm[0],
      camera[1] + pose.translationMm[1],
      camera[2] + pose.translationMm[2],
    ]);
    if (!pixel) throw new Error('synthetic pose put a model point behind the camera');
    return [pixel[0] + random.gaussian(sigmaPx), pixel[1] + random.gaussian(sigmaPx)];
  });
}

export function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? Number.NaN;
}
