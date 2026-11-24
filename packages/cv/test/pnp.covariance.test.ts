import { describe, expect, it } from 'vitest';
import { estimateIntrinsics } from '../src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import { mat3Multiply, mat3Transpose, type Mat3 } from '../src/linalg.ts';
import { solveHeadPose, type HeadPose, type HeadPoseSolution } from '../src/pnp.ts';
import { rotationMatrixFromVector, rotationVectorFromMatrix } from '../src/rotation.ts';
import { predictedPoseCovariance, whitenedPoseError } from './expectedError.ts';
import { seededRandom } from './random.ts';
import { projectWithNoise, sampleHeadPose } from './syntheticPose.ts';

const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 })!;
const DEG = Math.PI / 180;

function poseAt(yawDeg: number, pitchDeg: number, rollDeg: number, translationMm: readonly [number, number, number]): HeadPose {
  const yaw = rotationMatrixFromVector([0, yawDeg * DEG, 0]);
  const pitch = rotationMatrixFromVector([pitchDeg * DEG, 0, 0]);
  const roll = rotationMatrixFromVector([0, 0, rollDeg * DEG]);
  return { rotation: mat3Multiply(roll, mat3Multiply(yaw, pitch)) as Mat3, translationMm };
}

function solve(pixels: ReturnType<typeof projectWithNoise>): HeadPoseSolution {
  const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
  if (!solved.ok) throw new Error(`solve failed: ${solved.reason}`);
  return solved;
}

function standardDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : 0.5 * (sorted[mid - 1]! + sorted[mid]!);
}

/*
 * Bounds. One trial's reported SD scatters by about 1 / sqrt(2 * 60) = 9%
 * through the noise estimate; the median over trials removes most of that.
 * The Monte Carlo SD from 1,000 trials has a relative standard error of
 * 1 / sqrt(2000) = 2.2%, so 3 standard errors is 7%. The Huber loss and
 * outlier rejection cost efficiency the least-squares formula does not
 * model: the variance allowance kappa from docs/geometry.md is 1.0003 and
 * 1.018 at 0.5 and 1 px, at most 1% on the SD. A factor of 1.1 covers both.
 * At 2 px kappa is 1.49, so the report may fall up to sqrt(1.49) = 1.22
 * below the spread; with sampling error the factor there is 1.3.
 */
const MONTE_CARLO_TRIALS = 1000;
const AGREEMENT_FACTOR: Record<number, number> = { 0.5: 1.1, 1: 1.1, 2: 1.3 };

const FIXED_POSES: readonly [string, HeadPose][] = [
  ['frontal at 500 mm', poseAt(0, 0, 0, [0, 0, 500])],
  ['yaw 30, pitch -10 at 700 mm, off centre', poseAt(30, -10, 5, [60, -40, 700])],
  ['pitch 20, roll -15 at 400 mm', poseAt(-8, 20, -15, [-30, 20, 400])],
];

describe('solveHeadPose uncertainty', () => {
  for (const sigmaPx of [0.5, 1, 2]) {
    for (const [name, truth] of FIXED_POSES) {
      it(`matches the Monte Carlo spread within ${AGREEMENT_FACTOR[sigmaPx]}x: ${name}, ${sigmaPx} px`, () => {
        const random = seededRandom(9100 + sigmaPx * 10 + name.length);
        const rotationErrors: number[][] = [[], [], []];
        const translationErrors: number[][] = [[], [], []];
        const reportedRotation: number[][] = [[], [], []];
        const reportedTranslation: number[][] = [[], [], []];
        for (let trial = 0; trial < MONTE_CARLO_TRIALS; trial++) {
          const solved = solve(projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, sigmaPx, random));
          const uncertainty = solved.uncertainty!;
          const rotationError = rotationVectorFromMatrix(mat3Multiply(solved.rotation, mat3Transpose(truth.rotation)));
          for (let axis = 0; axis < 3; axis++) {
            rotationErrors[axis]!.push(rotationError[axis]! / DEG);
            translationErrors[axis]!.push(solved.translationMm[axis]! - truth.translationMm[axis]!);
            reportedRotation[axis]!.push(uncertainty.rotationStdDeg[axis]!);
            reportedTranslation[axis]!.push(uncertainty.translationStdMm[axis]!);
          }
        }
        const factor = AGREEMENT_FACTOR[sigmaPx]!;
        for (let axis = 0; axis < 3; axis++) {
          const rotationRatio = median(reportedRotation[axis]!) / standardDeviation(rotationErrors[axis]!);
          const translationRatio = median(reportedTranslation[axis]!) / standardDeviation(translationErrors[axis]!);
          expect(rotationRatio).toBeGreaterThan(1 / factor);
          expect(rotationRatio).toBeLessThan(factor);
          expect(translationRatio).toBeGreaterThan(1 / factor);
          expect(translationRatio).toBeLessThan(factor);
        }
      });
    }
  }

  /*
   * Whitened by the reported covariance, the squared rotation and
   * translation errors are chi-square with 3 degrees of freedom when the
   * report is right, so their mean over n trials is 3 with SD sqrt(6 / n).
   * The noise in the report comes from 60 residual degrees of freedom, which
   * raises the mean by 60 / 58, and the efficiency allowance at 1 px is
   * 1.018: expected 3.16. Over 1,000 random poses, 3.29 sqrt(6 / 1000) = 0.26
   * is the 0.05% one-sided margin, so the bound is 3.45. The lower bound 2.6
   * catches a report that is too wide.
   */
  it('gives whitened errors with a chi-square mean near 3 over random poses at 1 px', () => {
    const random = seededRandom(9300);
    let rotationSum = 0;
    let translationSum = 0;
    const trials = 1000;
    for (let trial = 0; trial < trials; trial++) {
      const truth = sampleHeadPose(random, intrinsics);
      const solved = solve(projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 1, random));
      const whitened = whitenedPoseError(truth, solved, Float64Array.from(solved.uncertainty!.covariance));
      rotationSum += whitened.rotation ** 2;
      translationSum += whitened.translation ** 2;
    }
    for (const nees of [rotationSum / trials, translationSum / trials]) {
      expect(nees).toBeGreaterThan(2.6);
      expect(nees).toBeLessThan(3.45);
    }
  });

  it('agrees with the covariance predicted at the true pose for the true noise', () => {
    const truth = poseAt(15, 5, 0, [20, 10, 600]);
    const random = seededRandom(9400);
    const solved = solve(projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 1, random));
    const predicted = predictedPoseCovariance(truth, RIGID_FACE_LANDMARKS, intrinsics, solved.uncertainty!.residualSigmaPx, solved.inlierIndices);
    const reported = solved.uncertainty!.covariance;
    for (const d of [0, 7, 14, 21, 28, 35]) {
      expect(reported[d]! / predicted[d]!).toBeGreaterThan(0.95);
      expect(reported[d]! / predicted[d]!).toBeLessThan(1.05);
    }
  });

  /*
   * The median of a scaled chi with about 60 degrees of freedom is 0.6%
   * below sigma. At 0.5 px the 2 px rejection floor is 4 sigma and almost
   * nothing is dropped, so the estimate is within 3%. At 1 px the threshold
   * is about 3.2 sigma, and the dropped tail (0.7% of points, each near
   * 3.3 px) lowers the estimate by about 2%, so the lower bound there is 0.94.
   */
  for (const [sigmaPx, lower] of [[0.5, 0.97], [1, 0.94]] as const) {
    it(`estimates the pixel noise from the residuals at ${sigmaPx} px`, () => {
      const random = seededRandom(9500 + sigmaPx * 10);
      const truth = poseAt(0, 0, 0, [0, 0, 550]);
      const estimates = Array.from(
        { length: 400 },
        () => solve(projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, sigmaPx, random)).uncertainty!.residualSigmaPx / sigmaPx,
      );
      expect(median(estimates)).toBeGreaterThan(lower);
      expect(median(estimates)).toBeLessThan(1.03);
    });
  }

  it('reports zero spread for exact correspondences and a symmetric covariance', () => {
    const truth = poseAt(10, -5, 3, [0, 0, 500]);
    const solved = solve(projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 0, seededRandom(1)));
    const { covariance, rotationStdDeg, translationStdMm } = solved.uncertainty!;
    expect(Math.max(...rotationStdDeg, ...translationStdMm)).toBeLessThan(1e-6);
    const noisy = solve(projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 1, seededRandom(2))).uncertainty!.covariance;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) expect(noisy[r * 6 + c]).toBeCloseTo(noisy[c * 6 + r]!, 12);
    expect(covariance).toHaveLength(36);
  });
});
