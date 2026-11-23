import { describe, expect, it } from 'vitest';
import { estimateIntrinsics } from '../src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import { solveHeadPose, type HeadPose, type SolveHeadPoseOptions } from '../src/pnp.ts';
import { angleBetweenRotations } from '../src/rotation.ts';
import { seededRandom } from './random.ts';
import { POSE_RANGE, percentile, projectWithNoise, sampleHeadPose } from './syntheticPose.ts';

const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 })!;
const TRIALS = 500;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Expected error per pixel of noise at the far limit, from first principles
 * for a frontal face (weak perspective, one parameter at a time):
 *
 * - Out-of-plane rotation (yaw, pitch) moves each point by f * d_i * dtheta / Z,
 *   where d_i is its depth offset from the centroid, so
 *   std = sigma * Z / (f * D), D^2 = (sum w d^2)^2 / sum w^2 d^2. That is the
 *   weighted least-squares variance when the noise is uniform and the weights
 *   are not inverse variances.
 * - Depth moves each point by f * r_i * dZ / Z^2 (r_i the in-plane radius), so
 *   std = sigma * Z^2 / (f * R) with R built like D from r_i. It grows with Z^2.
 * - The reported origin sits |c| behind the centroid, adding |c| times the
 *   rotation error; lateral translation adds sigma * Z / (f * sqrt(Neff)).
 *
 * p95 of an error vector norm is at most 2.8 standard deviations when the
 * largest component dominates (Maxwell distribution). The bound takes the
 * frontal pose at the maximum distance, both worst cases for these terms,
 * and a 1.5x margin for parameter coupling the one-at-a-time model ignores
 * and for Huber's efficiency loss once residuals pass the 3 px scale.
 */
function expectedP95PerPixel(): { rotationDeg: number; translationMm: number } {
  const points = RIGID_FACE_LANDMARKS;
  const totalWeight = points.reduce((sum, p) => sum + p.weight, 0);
  const centroid = [0, 1, 2].map((d) => points.reduce((sum, p) => sum + p.weight * p.positionMm[d], 0) / totalWeight);
  const effective = (squared: (p: (typeof points)[number]) => number): number => {
    const first = points.reduce((sum, p) => sum + p.weight * squared(p), 0);
    const second = points.reduce((sum, p) => sum + p.weight ** 2 * squared(p), 0);
    return Math.sqrt((first * first) / second);
  };
  const depthSpread = effective((p) => (p.positionMm[2] - centroid[2]!) ** 2);
  const radialSpread = effective((p) => (p.positionMm[0] - centroid[0]!) ** 2 + (p.positionMm[1] - centroid[1]!) ** 2);
  const neff = totalWeight ** 2 / points.reduce((sum, p) => sum + p.weight ** 2, 0);
  const z = POSE_RANGE.maxDistanceMm;
  const f = intrinsics.fx;
  const outOfPlaneStd = z / (f * depthSpread);
  const depthStd = (z * z) / (f * radialSpread);
  const lateralStd = z / (f * Math.sqrt(neff));
  const originOffset = Math.hypot(centroid[0]!, centroid[1]!, centroid[2]!);
  const translationStd = Math.sqrt(depthStd ** 2 + 2 * lateralStd ** 2 + 2 * (originOffset * outOfPlaneStd) ** 2);
  const maxwellP95 = 2.8;
  const margin = 1.5;
  return {
    rotationDeg: margin * maxwellP95 * outOfPlaneStd * RAD_TO_DEG,
    translationMm: margin * maxwellP95 * translationStd,
  };
}

const PER_PIXEL = expectedP95PerPixel();

interface TrialErrors {
  readonly rotationDeg: number[];
  readonly translationMm: number[];
  readonly failures: number;
}

function runTrials(
  seed: number,
  sigmaPx: number,
  options: SolveHeadPoseOptions = {},
  corrupt?: (pixels: [number, number][], random: ReturnType<typeof seededRandom>) => void,
): TrialErrors {
  const random = seededRandom(seed);
  const rotationDeg: number[] = [];
  const translationMm: number[] = [];
  let failures = 0;
  for (let trial = 0; trial < TRIALS; trial++) {
    const truth: HeadPose = sampleHeadPose(random, intrinsics);
    const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, sigmaPx, random) as [number, number][];
    corrupt?.(pixels, random);
    const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics, options);
    if (!solved.ok) {
      failures++;
      continue;
    }
    rotationDeg.push(angleBetweenRotations(truth.rotation, solved.rotation) * RAD_TO_DEG);
    translationMm.push(
      Math.hypot(
        solved.translationMm[0] - truth.translationMm[0],
        solved.translationMm[1] - truth.translationMm[1],
        solved.translationMm[2] - truth.translationMm[2],
      ),
    );
  }
  return { rotationDeg, translationMm, failures };
}

describe('solveHeadPose accuracy on synthetic ground truth', () => {
  it('recovers noise-free poses to near machine precision', () => {
    const errors = runTrials(100, 0);
    expect(errors.failures).toBe(0);
    // Round-off in a ~1000 px residual is ~1e-13 px; divided by the pose
    // sensitivity (~24 px/rad, ~0.07 px/mm at 900 mm) that is ~1e-14 rad and
    // ~1e-12 mm. The bounds leave four orders of magnitude for conditioning.
    expect(Math.max(...errors.rotationDeg) / RAD_TO_DEG).toBeLessThan(1e-10);
    expect(Math.max(...errors.translationMm)).toBeLessThan(1e-8);
  });

  it.each([0.5, 1, 2])('keeps p95 error within the first-principles bound at sigma %f px', (sigmaPx) => {
    const errors = runTrials(200 + sigmaPx * 10, sigmaPx);
    expect(errors.failures).toBe(0);
    const rotationP95 = percentile(errors.rotationDeg, 0.95);
    const translationP95 = percentile(errors.translationMm, 0.95);
    expect(rotationP95).toBeLessThan(PER_PIXEL.rotationDeg * sigmaPx);
    expect(translationP95).toBeLessThan(PER_PIXEL.translationMm * sigmaPx);
  });
});

describe('solveHeadPose outlier rejection', () => {
  const OUTLIER_FRACTION = 0.1;
  const displace = (pixels: [number, number][], random: ReturnType<typeof seededRandom>): void => {
    const count = Math.round(OUTLIER_FRACTION * pixels.length);
    const chosen = new Set<number>();
    while (chosen.size < count) chosen.add(random.integer(pixels.length));
    for (const index of chosen) {
      const distance = random.uniform(20, 60);
      const angle = random.uniform(0, 2 * Math.PI);
      const pixel = pixels[index]!;
      pixels[index] = [pixel[0] + distance * Math.cos(angle), pixel[1] + distance * Math.sin(angle)];
    }
  };

  it('stays within 1.5x the sigma 1 bound with 10% of points displaced 20 to 60 px, and beats no rejection', () => {
    const withRejection = runTrials(300, 1, {}, displace);
    const withoutRejection = runTrials(300, 1, { rejectOutliers: false }, displace);
    expect(withRejection.failures).toBe(0);
    expect(withoutRejection.failures).toBe(0);
    const rejectedRotation = percentile(withRejection.rotationDeg, 0.95);
    const rejectedTranslation = percentile(withRejection.translationMm, 0.95);
    expect(rejectedRotation).toBeLessThan(1.5 * PER_PIXEL.rotationDeg);
    expect(rejectedTranslation).toBeLessThan(1.5 * PER_PIXEL.translationMm);
    expect(rejectedRotation).toBeLessThan(percentile(withoutRejection.rotationDeg, 0.95));
    expect(rejectedTranslation).toBeLessThan(percentile(withoutRejection.translationMm, 0.95));
  });

  it('drops the displaced points from the inlier set', () => {
    const random = seededRandom(301);
    let displacedKept = 0;
    let displacedTotal = 0;
    for (let trial = 0; trial < 200; trial++) {
      const truth = sampleHeadPose(random, intrinsics);
      const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 1, random) as [number, number][];
      const clean = pixels.map((pixel) => [...pixel]);
      displace(pixels, random);
      const displaced = pixels.flatMap((pixel, index) => (pixel[0] !== clean[index]![0] ? [index] : []));
      const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
      expect(solved.ok).toBe(true);
      if (!solved.ok) continue;
      displacedTotal += displaced.length;
      displacedKept += displaced.filter((index) => solved.inlierIndices.includes(index)).length;
    }
    expect(displacedTotal).toBeGreaterThan(0);
    expect(displacedKept).toBe(0);
  });
});
