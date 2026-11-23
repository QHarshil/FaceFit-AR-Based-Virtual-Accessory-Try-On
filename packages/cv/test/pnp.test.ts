import { describe, expect, it } from 'vitest';
import { estimateIntrinsics, type CameraIntrinsics } from '../src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import { mat3Multiply, mat3MulVec3, type Mat3, type Vec2, type Vec3 } from '../src/linalg.ts';
import { solveHeadPose, type HeadPose, type HeadPoseResult, type WeightedModelPoint } from '../src/pnp.ts';
import { angleBetweenRotations, isRotationMatrix, rotationMatrixFromVector } from '../src/rotation.ts';
import { seededRandom } from './random.ts';
import { percentile, projectWithNoise, sampleHeadPose } from './syntheticPose.ts';

const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 })!;
const FRONTAL: HeadPose = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [0, 0, 600] };

function frontalPixels(model: readonly WeightedModelPoint[] = RIGID_FACE_LANDMARKS): Vec2[] {
  return projectWithNoise(FRONTAL, model, intrinsics, 0, seededRandom(0));
}

function expectFailure(result: HeadPoseResult, reason: string): void {
  expect(result).toEqual({ ok: false, reason });
}

function expectFiniteSolution(result: HeadPoseResult): void {
  if (!result.ok) return;
  expect(isRotationMatrix(result.rotation, 1e-9)).toBe(true);
  expect(result.translationMm.every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(result.rmsReprojectionPx)).toBe(true);
  expect(Number.isInteger(result.iterations)).toBe(true);
}

describe('solveHeadPose input validation', () => {
  it('rejects fewer points than the EPnP minimum', () => {
    const model = RIGID_FACE_LANDMARKS.slice(0, 3);
    expectFailure(solveHeadPose(frontalPixels(model), model, intrinsics), 'too-few-points');
    expectFailure(solveHeadPose([], [], intrinsics), 'too-few-points');
  });

  it('counts only points with positive weight toward the minimum', () => {
    const model = RIGID_FACE_LANDMARKS.map((point, index) => ({ ...point, weight: index < 3 ? 1 : 0 }));
    expectFailure(solveHeadPose(frontalPixels(), model, intrinsics), 'too-few-points');
  });

  it('rejects mismatched array lengths', () => {
    expectFailure(solveHeadPose(frontalPixels().slice(1), RIGID_FACE_LANDMARKS, intrinsics), 'mismatched-lengths');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects %f in image or model coordinates',
    (bad) => {
      const pixels = frontalPixels();
      pixels[5] = [bad, pixels[5]![1]];
      expectFailure(solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics), 'non-finite-input');
      const model = RIGID_FACE_LANDMARKS.map((point, index) =>
        index === 7 ? { ...point, positionMm: [point.positionMm[0], bad, point.positionMm[2]] as Vec3 } : point,
      );
      expectFailure(solveHeadPose(frontalPixels(), model, intrinsics), 'non-finite-input');
    },
  );

  it.each([-0.1, Number.NaN, Number.POSITIVE_INFINITY])('rejects weight %f', (weight) => {
    const model = RIGID_FACE_LANDMARKS.map((point, index) => (index === 2 ? { ...point, weight } : point));
    expectFailure(solveHeadPose(frontalPixels(), model, intrinsics), 'invalid-weights');
  });

  it('rejects collinear model points', () => {
    const model = RIGID_FACE_LANDMARKS.map((point, index) => ({
      positionMm: [index * 3 - 40, index * 2 - 20, index - 10] as Vec3,
      weight: point.weight,
    }));
    expectFailure(solveHeadPose(frontalPixels(model), model, intrinsics), 'degenerate-model');
  });

  it('rejects coplanar model points, which EPnP cannot handle', () => {
    const model = RIGID_FACE_LANDMARKS.map((point) => ({
      positionMm: [point.positionMm[0], point.positionMm[1], 0] as Vec3,
      weight: point.weight,
    }));
    expectFailure(solveHeadPose(frontalPixels(model), model, intrinsics), 'degenerate-model');
  });

  it('rejects collinear or coincident image points', () => {
    const collinear: Vec2[] = RIGID_FACE_LANDMARKS.map((_, index) => [400 + index * 5, 300 + index * 2]);
    expectFailure(solveHeadPose(collinear, RIGID_FACE_LANDMARKS, intrinsics), 'degenerate-image');
    const coincident: Vec2[] = RIGID_FACE_LANDMARKS.map(() => [640, 360]);
    expectFailure(solveHeadPose(coincident, RIGID_FACE_LANDMARKS, intrinsics), 'degenerate-image');
  });

  it.each<Partial<CameraIntrinsics>>([
    { width: 0 },
    { height: 0 },
    { fx: 0 },
    { fy: -1000 },
    { cx: Number.NaN },
    { fx: Number.POSITIVE_INFINITY },
  ])('rejects intrinsics with %o', (override) => {
    expectFailure(
      solveHeadPose(frontalPixels(), RIGID_FACE_LANDMARKS, { ...intrinsics, ...override }),
      'invalid-intrinsics',
    );
  });

  it('rejects an initial pose that is not a rotation', () => {
    const scaled: Mat3 = [2, 0, 0, 0, 2, 0, 0, 0, 2];
    expectFailure(
      solveHeadPose(frontalPixels(), RIGID_FACE_LANDMARKS, intrinsics, {
        initialPose: { rotation: scaled, translationMm: [0, 0, 600] },
      }),
      'invalid-initial-pose',
    );
    expectFailure(
      solveHeadPose(frontalPixels(), RIGID_FACE_LANDMARKS, intrinsics, {
        initialPose: { rotation: FRONTAL.rotation, translationMm: [0, Number.NaN, 600] },
      }),
      'invalid-initial-pose',
    );
  });

  it.each([{ robustLossScalePx: 0 }, { outlierMadMultiple: -1 }, { maxIterations: 0 }, { maxIterations: 2.5 }])(
    'rejects options %o',
    (options) => {
      expectFailure(solveHeadPose(frontalPixels(), RIGID_FACE_LANDMARKS, intrinsics, options), 'invalid-options');
    },
  );

  it('reports malformed input from untyped callers instead of throwing', () => {
    const untyped = solveHeadPose as (...args: unknown[]) => HeadPoseResult;
    expectFailure(untyped(null, RIGID_FACE_LANDMARKS, intrinsics), 'malformed-input');
    expectFailure(untyped(frontalPixels(), RIGID_FACE_LANDMARKS, undefined), 'malformed-input');
    const withHole = [...frontalPixels()];
    (withHole as unknown[])[4] = undefined;
    expectFailure(untyped(withHole, RIGID_FACE_LANDMARKS, intrinsics), 'malformed-input');
  });
});

describe('solveHeadPose contract', () => {
  it('returns the frontal pose for a noise-free frontal face', () => {
    const solved = solveHeadPose(frontalPixels(), RIGID_FACE_LANDMARKS, intrinsics);
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(angleBetweenRotations(solved.rotation, FRONTAL.rotation)).toBeLessThan(1e-12);
    for (let d = 0; d < 3; d++) expect(Math.abs(solved.translationMm[d] - FRONTAL.translationMm[d])).toBeLessThan(1e-9);
    expect(solved.rmsReprojectionPx).toBeLessThan(1e-9);
    expect(solved.inlierIndices).toEqual(RIGID_FACE_LANDMARKS.map((_, index) => index));
  });

  it('ignores zero-weight points and leaves them out of the inliers', () => {
    const pixels = frontalPixels();
    pixels[0] = [pixels[0]![0] + 300, pixels[0]![1] - 200];
    const model = RIGID_FACE_LANDMARKS.map((point, index) => (index === 0 ? { ...point, weight: 0 } : point));
    const solved = solveHeadPose(pixels, model, intrinsics, { rejectOutliers: false });
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(solved.inlierIndices).not.toContain(0);
    expect(angleBetweenRotations(solved.rotation, FRONTAL.rotation)).toBeLessThan(1e-12);
  });

  it('converges from a warm start near the true pose', () => {
    const random = seededRandom(41);
    for (let trial = 0; trial < 50; trial++) {
      const truth = sampleHeadPose(random, intrinsics);
      const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 0, random);
      const nudge = rotationMatrixFromVector([0.05, -0.04, 0.03]);
      const initialPose: HeadPose = {
        rotation: mat3Multiply(nudge, truth.rotation),
        translationMm: [truth.translationMm[0] + 15, truth.translationMm[1] - 10, truth.translationMm[2] + 30],
      };
      const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics, { initialPose });
      expect(solved.ok).toBe(true);
      if (solved.ok) expect(angleBetweenRotations(solved.rotation, truth.rotation)).toBeLessThan(1e-10);
    }
  });

  it('falls back to EPnP when the warm start is far off or behind the camera', () => {
    const random = seededRandom(42);
    const truth = sampleHeadPose(random, intrinsics);
    const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 0, random);
    const flipped: HeadPose = {
      rotation: mat3Multiply(rotationMatrixFromVector([0, Math.PI, 0]), truth.rotation),
      translationMm: [0, 0, -500],
    };
    const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics, { initialPose: flipped });
    expect(solved.ok).toBe(true);
    if (solved.ok) expect(angleBetweenRotations(solved.rotation, truth.rotation)).toBeLessThan(1e-10);
  });

  it('is deterministic', () => {
    const random = seededRandom(43);
    const truth = sampleHeadPose(random, intrinsics);
    const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 1, random);
    expect(solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics)).toEqual(
      solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics),
    );
  });

  it('never throws or returns NaN on random garbage input', () => {
    const random = seededRandom(44);
    for (let trial = 0; trial < 300; trial++) {
      const count = 4 + random.integer(40);
      const model: WeightedModelPoint[] = Array.from({ length: count }, () => ({
        positionMm: [random.uniform(-100, 100), random.uniform(-100, 100), random.uniform(-100, 100)],
        weight: random.uniform(0, 1),
      }));
      const pixels: Vec2[] = Array.from({ length: count }, () => [
        random.uniform(-2000, 3000),
        random.uniform(-2000, 3000),
      ]);
      const result = solveHeadPose(pixels, model, intrinsics);
      expectFiniteSolution(result);
    }
  });

  it('reports a higher RMS when the image does not match the model', () => {
    const random = seededRandom(45);
    const truth = sampleHeadPose(random, intrinsics);
    const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 0.5, random);
    const shuffled = [...pixels].reverse();
    const matched = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
    const mismatched = solveHeadPose(shuffled, RIGID_FACE_LANDMARKS, intrinsics);
    expect(matched.ok).toBe(true);
    if (!matched.ok || !mismatched.ok) return;
    expect(mismatched.rmsReprojectionPx).toBeGreaterThan(10 * matched.rmsReprojectionPx);
  });
});

describe('solveHeadPose optimality', () => {
  const HUBER_PX = 3;

  function weightedHuberCost(pose: HeadPose, pixels: readonly Vec2[], inliers: readonly number[]): number {
    let cost = 0;
    for (const index of inliers) {
      const point = RIGID_FACE_LANDMARKS[index]!;
      const camera = mat3MulVec3(pose.rotation, point.positionMm);
      const z = camera[2] + pose.translationMm[2];
      const u = (intrinsics.fx * (camera[0] + pose.translationMm[0])) / z + intrinsics.cx;
      const v = (intrinsics.fy * (camera[1] + pose.translationMm[1])) / z + intrinsics.cy;
      const squared = (u - pixels[index]![0]) ** 2 + (v - pixels[index]![1]) ** 2;
      const huber = squared <= HUBER_PX ** 2 ? squared : 2 * HUBER_PX * Math.sqrt(squared) - HUBER_PX ** 2;
      cost += point.weight * huber;
    }
    return cost;
  }

  function perturb(pose: HeadPose, axis: number, step: number): HeadPose {
    if (axis < 3) {
      const rotationVector: [number, number, number] = [0, 0, 0];
      rotationVector[axis] = step;
      const rotation = mat3Multiply(rotationMatrixFromVector(rotationVector), pose.rotation);
      return { rotation, translationMm: pose.translationMm };
    }
    const translationMm: [number, number, number] = [...pose.translationMm];
    translationMm[axis - 3] += step;
    return { rotation: pose.rotation, translationMm };
  }

  it('returns a stationary point of the weighted Huber objective on its inliers', () => {
    // Sigma 2 puts about a third of the residuals past the 3 px Huber scale.
    // Along each axis a Newton step g / h from central differences estimates
    // the distance to the minimum. The solver stops at a relative cost change
    // of 1e-12, about 1e-7 rad and 1e-4 mm from the minimum here.
    const random = seededRandom(46);
    for (let trial = 0; trial < 50; trial++) {
      const truth = sampleHeadPose(random, intrinsics);
      const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 2, random);
      const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics, { robustLossScalePx: HUBER_PX });
      expect(solved.ok).toBe(true);
      if (!solved.ok) continue;
      const center = weightedHuberCost(solved, pixels, solved.inlierIndices);
      for (let axis = 0; axis < 6; axis++) {
        const step = axis < 3 ? 1e-4 : 1e-2;
        const plus = weightedHuberCost(perturb(solved, axis, step), pixels, solved.inlierIndices);
        const minus = weightedHuberCost(perturb(solved, axis, -step), pixels, solved.inlierIndices);
        const gradient = (plus - minus) / (2 * step);
        const curvature = (plus + minus - 2 * center) / (step * step);
        expect(curvature).toBeGreaterThan(0);
        expect(Math.abs(gradient / curvature)).toBeLessThan(axis < 3 ? 1e-6 : 1e-3);
      }
    }
  });

  it('converges in few iterations when many residuals are past the Huber scale', () => {
    // Removing the curvature along the residual for linear-branch points
    // gives Newton-like convergence: about four iterations per refinement,
    // and usually two refinements. Plain reweighting needs about twice as many.
    // A point flipping in and out of the inlier set would repeat refinements
    // up to the round cap; stopping on a repeated set keeps it to about four.
    const random = seededRandom(47);
    const iterations: number[] = [];
    for (let trial = 0; trial < 200; trial++) {
      const truth = sampleHeadPose(random, intrinsics);
      const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 2, random);
      const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
      if (solved.ok) iterations.push(solved.iterations);
    }
    expect(iterations).toHaveLength(200);
    expect(percentile(iterations, 0.5)).toBeLessThanOrEqual(8);
    expect(Math.max(...iterations)).toBeLessThanOrEqual(16);
  });
});
