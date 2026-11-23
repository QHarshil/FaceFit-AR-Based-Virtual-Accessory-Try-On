import { describe, expect, it } from 'vitest';
import { estimateIntrinsics } from '../src/camera.ts';
import { solveEpnp } from '../src/epnp.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import { mat3Multiply, mat3MulVec3, type Vec2 } from '../src/linalg.ts';
import { solveHeadPose, type HeadPose, type SolveHeadPoseOptions } from '../src/pnp.ts';
import { angleBetweenRotations, rotationMatrixFromVector } from '../src/rotation.ts';
import { predictedPoseCovariance, whitenedPoseError } from './expectedError.ts';
import { seededRandom, type SeededRandom } from './random.ts';
import { POSE_RANGE, percentile, projectWithNoise, sampleHeadPose } from './syntheticPose.ts';

const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 })!;
const RAD_TO_DEG = 180 / Math.PI;
const ALL_POINTS = RIGID_FACE_LANDMARKS.map((_, index) => index);

/*
 * Expected error, derived before the first run (docs/geometry.md, "Expected
 * error"). Each trial's error is whitened by its own first-order covariance,
 * which carries the distance, the pose and the model spread. For a solver
 * that attains that covariance, the squared whitened error of the rotation
 * (and of the translation) is chi-square with 3 degrees of freedom, so its
 * mean over n trials (the NEES) is 3 with standard deviation sqrt(6 / n).
 *
 * The solver gives up some efficiency on purpose. Allowance kappa, an
 * inflation of the covariance, treats every point past the Huber scale c and
 * every point past the rejection threshold tau as carrying no information:
 * kappa = 1 / ((1 - P(r > c / sigma)) (1 - P(r > tau / sigma))), with r
 * Rayleigh distributed. Asymptotic Huber theory gives less (1.053 at sigma
 * 2); with about 13 effective points, the finite-sample loss is larger.
 */
const HUBER_SCALE_PX = 3;
/** median + 3 * 1.4826 * MAD of a Rayleigh variable, in units of sigma. */
const REJECTION_THRESHOLD_SIGMAS = 3.172;
const MIN_OUTLIER_THRESHOLD_PX = 2;
const CLEAN_TRIALS = 2000;
/** One-sided z for a 0.1% family-wise false failure over the six NEES checks. */
const NEES_Z = 3.588;
const ROBUSTNESS_TRIALS = 500;
/** The 95th percentile of 500 chi-3 samples stays below this with probability 0.999. */
const CHI3_P95_UPPER_500 = 3.015;

function efficiencyAllowance(sigmaPx: number): number {
  const huberSigmas = HUBER_SCALE_PX / sigmaPx;
  const rejectionSigmas = Math.max(REJECTION_THRESHOLD_SIGMAS * sigmaPx, MIN_OUTLIER_THRESHOLD_PX) / sigmaPx;
  const tail = (sigmas: number): number => Math.exp(-(sigmas ** 2) / 2);
  return 1 / ((1 - tail(huberSigmas)) * (1 - tail(rejectionSigmas)));
}

function neesBound(sigmaPx: number): number {
  const kappa = efficiencyAllowance(sigmaPx);
  return kappa * (3 + NEES_Z * Math.sqrt(6 / CLEAN_TRIALS));
}

/** p95 of whitened error at sigma 1 px over the robustness trials. */
const SIGMA1_P95_BOUND = Math.sqrt(efficiencyAllowance(1)) * CHI3_P95_UPPER_500;

type Solver = (pixels: readonly Vec2[], sigmaPx: number) => HeadPose | null;

interface Trial {
  readonly truth: HeadPose;
  readonly pixels: readonly Vec2[];
  readonly covariance: Float64Array;
}

const cleanTrials = new Map<number, readonly Trial[]>();

function cleanTrialsAt(sigmaPx: number): readonly Trial[] {
  const cached = cleanTrials.get(sigmaPx);
  if (cached) return cached;
  const random = seededRandom(200 + sigmaPx * 10);
  const trials = Array.from({ length: CLEAN_TRIALS }, () => {
    const truth = sampleHeadPose(random, intrinsics);
    const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, sigmaPx, random);
    return { truth, pixels, covariance: predictedPoseCovariance(truth, RIGID_FACE_LANDMARKS, intrinsics, sigmaPx) };
  });
  cleanTrials.set(sigmaPx, trials);
  return trials;
}

interface Consistency {
  readonly neesRotation: number;
  readonly neesTranslation: number;
  readonly failures: number;
}

function consistency(solve: Solver, sigmaPx: number): Consistency {
  let rotationSum = 0;
  let translationSum = 0;
  let solved = 0;
  for (const trial of cleanTrialsAt(sigmaPx)) {
    const pose = solve(trial.pixels, sigmaPx);
    if (!pose) continue;
    const whitened = whitenedPoseError(trial.truth, pose, trial.covariance);
    rotationSum += whitened.rotation ** 2;
    translationSum += whitened.translation ** 2;
    solved++;
  }
  return {
    neesRotation: rotationSum / solved,
    neesTranslation: translationSum / solved,
    failures: CLEAN_TRIALS - solved,
  };
}

function passesAccuracyBound(solve: Solver): boolean {
  return [0.5, 1, 2].every((sigmaPx) => {
    const measured = consistency(solve, sigmaPx);
    const bound = neesBound(sigmaPx);
    return measured.failures === 0 && measured.neesRotation <= bound && measured.neesTranslation <= bound;
  });
}

const shippedSolver: Solver = (pixels) => {
  const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
  return solved.ok ? solved : null;
};

/**
 * EPnP's closed-form pose with no Levenberg-Marquardt refinement: the
 * candidate with the lowest weighted squared reprojection error.
 */
const epnpOnlySolver: Solver = (pixels) => {
  const n = RIGID_FACE_LANDMARKS.length;
  const model = new Float64Array(3 * n);
  const normalized = new Float64Array(2 * n);
  const weights = new Float64Array(n);
  RIGID_FACE_LANDMARKS.forEach((point, index) => {
    model.set(point.positionMm, 3 * index);
    normalized[2 * index] = (pixels[index]![0] - intrinsics.cx) / intrinsics.fx;
    normalized[2 * index + 1] = (pixels[index]![1] - intrinsics.cy) / intrinsics.fy;
    weights[index] = point.weight * n;
  });
  const reprojectionError = (pose: HeadPose): number =>
    RIGID_FACE_LANDMARKS.reduce((sum, point, index) => {
      const camera = mat3MulVec3(pose.rotation, point.positionMm);
      const z = camera[2] + pose.translationMm[2];
      if (!(z > 0)) return Number.POSITIVE_INFINITY;
      const ex = (camera[0] + pose.translationMm[0]) / z - normalized[2 * index]!;
      const ey = (camera[1] + pose.translationMm[1]) / z - normalized[2 * index + 1]!;
      return sum + point.weight * (ex * ex + ey * ey);
    }, 0);
  let best: HeadPose | null = null;
  for (const candidate of solveEpnp(model, normalized, weights, ALL_POINTS)) {
    const pose = { rotation: candidate.rotation, translationMm: candidate.translation };
    if (!best || reprojectionError(pose) < reprojectionError(best)) best = pose;
  }
  return best;
};

/** The shipped solver with its pitch biased by 1.5 degrees per pixel of noise. */
const pitchBiasedSolver: Solver = (pixels, sigmaPx) => {
  const pose = shippedSolver(pixels, sigmaPx);
  if (!pose) return null;
  const bias = rotationMatrixFromVector([(1.5 * sigmaPx) / RAD_TO_DEG, 0, 0]);
  return { rotation: mat3Multiply(bias, pose.rotation), translationMm: pose.translationMm };
};

describe('solveHeadPose accuracy on synthetic ground truth', () => {
  it('recovers noise-free poses to near machine precision', () => {
    const random = seededRandom(100);
    let worstRotation = 0;
    let worstTranslation = 0;
    for (let trial = 0; trial < ROBUSTNESS_TRIALS; trial++) {
      const truth = sampleHeadPose(random, intrinsics);
      const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 0, random);
      const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
      expect(solved.ok).toBe(true);
      if (!solved.ok) continue;
      worstRotation = Math.max(worstRotation, angleBetweenRotations(truth.rotation, solved.rotation));
      worstTranslation = Math.max(
        worstTranslation,
        Math.hypot(...[0, 1, 2].map((d) => solved.translationMm[d]! - truth.translationMm[d]!)),
      );
    }
    // Round-off in a ~1000 px residual is ~1e-13 px; divided by the pose
    // sensitivity (~24 px/rad, ~0.07 px/mm at 900 mm) that is ~1e-14 rad and
    // ~1e-12 mm. The bounds leave four orders of magnitude for conditioning.
    expect(worstRotation).toBeLessThan(1e-10);
    expect(worstTranslation).toBeLessThan(1e-8);
  });

  it.each([0.5, 1, 2])('keeps per-trial whitened error within the first-principles bound at sigma %f px', (sigmaPx) => {
    const measured = consistency(shippedSolver, sigmaPx);
    expect(measured.failures).toBe(0);
    expect(measured.neesRotation).toBeLessThan(neesBound(sigmaPx));
    expect(measured.neesTranslation).toBeLessThan(neesBound(sigmaPx));
  });

  it('fails EPnP without refinement and a solver biased 1.5 deg per pixel in pitch', () => {
    expect(passesAccuracyBound(shippedSolver)).toBe(true);
    expect(passesAccuracyBound(epnpOnlySolver)).toBe(false);
    expect(passesAccuracyBound(pitchBiasedSolver)).toBe(false);
  });
});

/** Changes some of the noisy pixels in place and returns their indices. */
type Corruption = (pixels: Vec2[], random: SeededRandom, truth: HeadPose) => readonly number[];

interface RobustnessErrors {
  readonly rotation: number[];
  readonly translation: number[];
  readonly failures: number;
  readonly corruptedKept: number;
  readonly corruptedTotal: number;
}

/**
 * Whitens each error by the covariance of a fit to the uncorrupted points,
 * the accuracy that perfect rejection would reach.
 */
function runCorrupted(seed: number, corrupt: Corruption, options: SolveHeadPoseOptions = {}): RobustnessErrors {
  const random = seededRandom(seed);
  const rotation: number[] = [];
  const translation: number[] = [];
  let failures = 0;
  let corruptedKept = 0;
  let corruptedTotal = 0;
  for (let trial = 0; trial < ROBUSTNESS_TRIALS; trial++) {
    const truth = sampleHeadPose(random, intrinsics);
    const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 1, random);
    const corrupted = corrupt(pixels, random, truth);
    const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics, options);
    if (!solved.ok) {
      failures++;
      continue;
    }
    const clean = ALL_POINTS.filter((index) => !corrupted.includes(index));
    const covariance = predictedPoseCovariance(truth, RIGID_FACE_LANDMARKS, intrinsics, 1, clean);
    const whitened = whitenedPoseError(truth, solved, covariance);
    rotation.push(whitened.rotation);
    translation.push(whitened.translation);
    corruptedTotal += corrupted.length;
    corruptedKept += corrupted.filter((index) => solved.inlierIndices.includes(index)).length;
  }
  return { rotation, translation, failures, corruptedKept, corruptedTotal };
}

describe('solveHeadPose outlier rejection', () => {
  const OUTLIER_FRACTION = 0.1;
  const displaceRandomPoints: Corruption = (pixels, random) => {
    const count = Math.round(OUTLIER_FRACTION * pixels.length);
    const chosen = new Set<number>();
    while (chosen.size < count) chosen.add(random.integer(pixels.length));
    for (const index of chosen) {
      const distance = random.uniform(20, 60);
      const angle = random.uniform(0, 2 * Math.PI);
      const pixel = pixels[index]!;
      pixels[index] = [pixel[0] + distance * Math.cos(angle), pixel[1] + distance * Math.sin(angle)];
    }
    return [...chosen];
  };

  it('stays within 1.5x the sigma 1 bound with 10% of points displaced 20 to 60 px, and beats no rejection', () => {
    const withRejection = runCorrupted(300, displaceRandomPoints);
    const withoutRejection = runCorrupted(300, displaceRandomPoints, { rejectOutliers: false });
    expect(withRejection.failures).toBe(0);
    expect(withoutRejection.failures).toBe(0);
    const rejectedRotation = percentile(withRejection.rotation, 0.95);
    const rejectedTranslation = percentile(withRejection.translation, 0.95);
    expect(rejectedRotation).toBeLessThan(1.5 * SIGMA1_P95_BOUND);
    expect(rejectedTranslation).toBeLessThan(1.5 * SIGMA1_P95_BOUND);
    expect(rejectedRotation).toBeLessThan(percentile(withoutRejection.rotation, 0.95));
    expect(rejectedTranslation).toBeLessThan(percentile(withoutRejection.translation, 0.95));
  });

  it('drops the displaced points from the inlier set', () => {
    const errors = runCorrupted(301, displaceRandomPoints);
    expect(errors.failures).toBe(0);
    expect(errors.corruptedTotal).toBeGreaterThan(0);
    expect(errors.corruptedKept).toBe(0);
  });
});

describe('solveHeadPose rejection of heavily weighted landmarks', () => {
  const indexOf = (landmarkIndex: number): number =>
    RIGID_FACE_LANDMARKS.findIndex((point) => point.landmarkIndex === landmarkIndex);

  it('rejects the four heaviest landmarks when they move 20 px together', () => {
    // 129, 358, 4 and 136 carry 45% of the weight, enough to drag a weighted fit.
    const heavy = [129, 358, 4, 136].map(indexOf);
    const shiftHeavy: Corruption = (pixels, random) => {
      const angle = random.uniform(0, 2 * Math.PI);
      for (const index of heavy) {
        const pixel = pixels[index]!;
        pixels[index] = [pixel[0] + 20 * Math.cos(angle), pixel[1] + 20 * Math.sin(angle)];
      }
      return heavy;
    };
    const errors = runCorrupted(302, shiftHeavy);
    expect(errors.failures).toBe(0);
    expect(errors.corruptedKept).toBe(0);
    expect(percentile(errors.rotation, 0.95)).toBeLessThan(1.5 * SIGMA1_P95_BOUND);
  });

  it('keeps a 5 mm jaw drop within the sigma 1 bound', () => {
    // The jaw line (136, 365) moves 5 mm down in the face frame and its upper
    // neighbours (132, 361) 1.5 mm, as when the mouth opens.
    const jawDropMm = new Map([
      [indexOf(136), 5],
      [indexOf(365), 5],
      [indexOf(132), 1.5],
      [indexOf(361), 1.5],
    ]);
    const dropJaw: Corruption = (pixels, random, truth) => {
      for (const [index, dropMm] of jawDropMm) {
        const point = RIGID_FACE_LANDMARKS[index]!;
        const [x, y, z] = point.positionMm;
        const moved = { ...point, positionMm: [x, y + dropMm, z] as const };
        pixels[index] = projectWithNoise(truth, [moved], intrinsics, 1, random)[0]!;
      }
      return [...jawDropMm.keys()];
    };
    const errors = runCorrupted(303, dropJaw);
    expect(errors.failures).toBe(0);
    expect(percentile(errors.rotation, 0.95)).toBeLessThan(SIGMA1_P95_BOUND);
  });
});

describe('solveHeadPose initial pose and plausibility', () => {
  const RAD_PER_DEG = 1 / RAD_TO_DEG;
  const moveOnePoint = (random: SeededRandom, pixels: Vec2[], minPx: number, maxPx: number): void => {
    const index = random.integer(pixels.length);
    const angle = random.uniform(0, 2 * Math.PI);
    const distance = random.uniform(minPx, maxPx);
    const pixel = pixels[index]!;
    pixels[index] = [pixel[0] + distance * Math.cos(angle), pixel[1] + distance * Math.sin(angle)];
  };

  it('recovers far, strongly yawed faces that EPnP can return mirrored in depth', () => {
    // A chi-3 variable exceeds 6 with probability 7e-8, so no correct solve
    // among 1000 does. A depth-mirrored pose is off by tens of degrees.
    const farYawed = { ...POSE_RANGE, yawDeg: 70, minDistanceMm: 2500, maxDistanceMm: 2500 };
    const random = seededRandom(304);
    let worst = 0;
    for (let trial = 0; trial < 1000; trial++) {
      const truth = sampleHeadPose(random, intrinsics, farYawed);
      const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 1, random);
      const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
      expect(solved.ok).toBe(true);
      if (!solved.ok) continue;
      const covariance = predictedPoseCovariance(truth, RIGID_FACE_LANDMARKS, intrinsics, 1);
      worst = Math.max(worst, whitenedPoseError(truth, solved, covariance).rotation);
    }
    expect(worst).toBeLessThan(6);
  });

  it('is within 5 degrees whenever it succeeds with one point moved 100 to 300 px', () => {
    const random = seededRandom(400);
    let succeeded = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const truth = sampleHeadPose(random, intrinsics);
      const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 1, random);
      moveOnePoint(random, pixels, 100, 300);
      const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
      if (!solved.ok) continue;
      succeeded++;
      expect(angleBetweenRotations(truth.rotation, solved.rotation)).toBeLessThan(5 * RAD_PER_DEG);
    }
    expect(succeeded).toBeGreaterThanOrEqual(1980);
  });

  it('never succeeds with a depth outside the plausible range when one point is 700 px off', () => {
    const random = seededRandom(401);
    for (let trial = 0; trial < 1000; trial++) {
      const truth = sampleHeadPose(random, intrinsics);
      const pixels = projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, 1, random);
      moveOnePoint(random, pixels, 700, 700);
      const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
      if (!solved.ok) continue;
      expect(solved.translationMm[2]).toBeGreaterThanOrEqual(100);
      expect(solved.translationMm[2]).toBeLessThanOrEqual(5000);
    }
  });
});
