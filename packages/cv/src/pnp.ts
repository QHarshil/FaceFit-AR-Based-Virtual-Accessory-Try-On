import { isValidIntrinsics, type CameraIntrinsics } from './camera.ts';
import { solveEpnp, type RigidPose } from './epnp.ts';
import { mat3Multiply, mat3MulVec3, solveCholesky, symmetricEigen, type Mat3, type Vec2, type Vec3 } from './linalg.ts';
import { isRotationMatrix, reorthonormalize, rotationMatrixFromVector } from './rotation.ts';

export interface WeightedModelPoint {
  readonly positionMm: Vec3;
  readonly weight: number;
}

/** Model-to-camera transform: a model point p maps to rotation * p + translationMm. */
export interface HeadPose {
  readonly rotation: Mat3;
  readonly translationMm: Vec3;
}

export interface SolveHeadPoseOptions {
  /**
   * Previous pose for tracking. It is a second starting point next to EPnP;
   * refinement starts from whichever has the lower Huber cost.
   */
  readonly initialPose?: HeadPose;
  /** Huber loss scale on the per-point reprojection error, in pixels. */
  readonly huberScalePx?: number;
  /** Set false to keep every point; the Huber loss still applies. */
  readonly rejectOutliers?: boolean;
  /** k in the outlier threshold median + k * 1.4826 * MAD of residual norms. */
  readonly outlierMadMultiple?: number;
  /** Lower bound on the outlier threshold, in pixels. */
  readonly minOutlierThresholdPx?: number;
  /** Levenberg-Marquardt iteration cap per refinement round. */
  readonly maxIterations?: number;
}

export type HeadPoseFailureReason =
  | 'malformed-input'
  | 'invalid-options'
  | 'mismatched-lengths'
  | 'too-few-points'
  | 'non-finite-input'
  | 'invalid-weights'
  | 'invalid-intrinsics'
  | 'invalid-initial-pose'
  | 'degenerate-model'
  | 'degenerate-image'
  | 'no-solution';

export interface HeadPoseSolution extends HeadPose {
  readonly ok: true;
  /** Unweighted RMS reprojection error over the inliers, in pixels. */
  readonly rmsReprojectionPx: number;
  /** Indices into the input arrays of the points used in the final fit. */
  readonly inlierIndices: readonly number[];
  /** Levenberg-Marquardt iterations summed over all refinement rounds. */
  readonly iterations: number;
}

export interface HeadPoseFailure {
  readonly ok: false;
  readonly reason: HeadPoseFailureReason;
}

export type HeadPoseResult = HeadPoseSolution | HeadPoseFailure;

/** EPnP needs four points; fewer leave the pose ambiguous. */
export const MIN_POINTS = 4;

/** Rejection never leaves fewer than this many points, so 12 equations constrain 6 unknowns. */
const MIN_INLIERS_AFTER_REJECTION = 6;
const MAX_REJECTION_ROUNDS = 4;
/** Scales the MAD to a standard deviation for Gaussian data. */
const MAD_TO_SIGMA = 1.4826;
/** Collinear when the second principal variance is this small relative to the first. */
const COLLINEAR_VARIANCE_RATIO = 1e-12;
/** Planar when thinner than 0.1% of the widest axis; EPnP needs depth spread. */
const PLANAR_VARIANCE_RATIO = 1e-6;

const DEFAULTS = {
  huberScalePx: 3,
  rejectOutliers: true,
  outlierMadMultiple: 3,
  minOutlierThresholdPx: 2,
  maxIterations: 30,
};

/**
 * Recovers the head pose from 2D-3D correspondences: imagePoints[i] in pixels
 * corresponds to modelPoints[i] in millimetres. Initial pose by EPnP, chosen
 * because it is closed form and O(n), and LM refinement recovers the accuracy
 * it loses under noise. Then weighted Huber Levenberg-Marquardt, MAD-based
 * outlier rejection on an equal-weight fit, and a weighted refit on the
 * inliers. Never throws; failures return ok: false.
 */
export function solveHeadPose(
  imagePoints: readonly Vec2[],
  modelPoints: readonly WeightedModelPoint[],
  intrinsics: CameraIntrinsics,
  options: SolveHeadPoseOptions = {},
): HeadPoseResult {
  try {
    return solve(imagePoints, modelPoints, intrinsics, options);
  } catch {
    // Untyped callers can pass null arrays or intrinsics; report them instead of throwing.
    return { ok: false, reason: 'malformed-input' };
  }
}

function solve(
  imagePoints: readonly Vec2[],
  modelPoints: readonly WeightedModelPoint[],
  intrinsics: CameraIntrinsics,
  options: SolveHeadPoseOptions,
): HeadPoseResult {
  const settings = resolveSettings(options);
  if (!settings) return { ok: false, reason: 'invalid-options' };
  if (imagePoints.length !== modelPoints.length) return { ok: false, reason: 'mismatched-lengths' };
  if (!isValidIntrinsics(intrinsics)) return { ok: false, reason: 'invalid-intrinsics' };
  const warm = options.initialPose;
  if (warm && (!isRotationMatrix(warm.rotation, 1e-6) || !warm.translationMm.every(Number.isFinite))) {
    return { ok: false, reason: 'invalid-initial-pose' };
  }

  const n = imagePoints.length;
  const pixels = new Float64Array(2 * n);
  const modelRaw = new Float64Array(3 * n);
  const weights = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const image = imagePoints[i];
    const point = modelPoints[i];
    if (!image || !point || !point.positionMm) return { ok: false, reason: 'malformed-input' };
    const [u, v] = image;
    const [x, y, z] = point.positionMm;
    if (![u, v, x, y, z].every(Number.isFinite)) return { ok: false, reason: 'non-finite-input' };
    if (!Number.isFinite(point.weight) || point.weight < 0) return { ok: false, reason: 'invalid-weights' };
    pixels[2 * i] = u;
    pixels[2 * i + 1] = v;
    modelRaw.set([x, y, z], 3 * i);
    weights[i] = point.weight;
  }

  const active: number[] = [];
  for (let i = 0; i < n; i++) if (weights[i] > 0) active.push(i);
  if (active.length < MIN_POINTS) return { ok: false, reason: 'too-few-points' };

  // Weights normalized to mean 1 keep the Huber scale in plain pixels.
  const meanWeight = active.reduce((sum, i) => sum + weights[i], 0) / active.length;
  for (const i of active) weights[i] /= meanWeight;

  // Centring the model on its weighted centroid decouples rotation from translation in LM.
  const centroid: [number, number, number] = [0, 0, 0];
  for (const i of active) for (let d = 0; d < 3; d++) centroid[d] += (weights[i] * modelRaw[3 * i + d]) / active.length;
  const model = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) model[3 * i + d] = modelRaw[3 * i + d] - centroid[d];

  const modelShape = principalVariances(model, active, 3);
  if (!(modelShape[2] > 0) || modelShape[1] <= COLLINEAR_VARIANCE_RATIO * modelShape[2]) {
    return { ok: false, reason: 'degenerate-model' };
  }
  if (modelShape[0] <= PLANAR_VARIANCE_RATIO * modelShape[2]) return { ok: false, reason: 'degenerate-model' };
  const imageShape = principalVariances(pixels, active, 2);
  if (!(imageShape[1] > 1e-12) || imageShape[0] <= COLLINEAR_VARIANCE_RATIO * imageShape[1]) {
    return { ok: false, reason: 'degenerate-image' };
  }

  const problem: Problem = { model, pixels, weights, intrinsics, huber: settings.huberScalePx };

  const candidates: RigidPose[] = [];
  const normalized = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    normalized[2 * i] = (pixels[2 * i] - intrinsics.cx) / intrinsics.fx;
    normalized[2 * i + 1] = (pixels[2 * i + 1] - intrinsics.cy) / intrinsics.fy;
  }
  const epnpPose = solveEpnp(model, normalized, weights, active);
  if (epnpPose) candidates.push(epnpPose);
  if (warm) {
    const rotation = reorthonormalize(warm.rotation);
    const shift = mat3MulVec3(rotation, centroid);
    candidates.push({
      rotation,
      translation: [
        warm.translationMm[0] + shift[0],
        warm.translationMm[1] + shift[1],
        warm.translationMm[2] + shift[2],
      ],
    });
  }

  let pose: RigidPose | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const cost = weightedHuberCost(problem, active, candidate);
    if (cost < bestCost) {
      bestCost = cost;
      pose = candidate;
    }
  }
  if (!pose) return { ok: false, reason: 'no-solution' };

  const weightedFit = refinePose(problem, active, pose, settings.maxIterations);
  pose = weightedFit.pose;
  let iterations = weightedFit.iterations;
  let inliers: readonly number[] = active;
  if (settings.rejectOutliers) {
    const rejection = rejectWithEqualWeights(problem, active, pose, settings);
    iterations += rejection.iterations;
    if (rejection.inliers.length < active.length) {
      inliers = rejection.inliers;
      const start =
        weightedHuberCost(problem, inliers, rejection.pose) < weightedHuberCost(problem, inliers, pose)
          ? rejection.pose
          : pose;
      const inlierFit = refinePose(problem, inliers, start, settings.maxIterations);
      pose = inlierFit.pose;
      iterations += inlierFit.iterations;
    }
  }

  const norms = residualNorms(problem, inliers, pose);
  let sumSq = 0;
  for (const norm of norms) sumSq += norm * norm;
  const rms = Math.sqrt(sumSq / inliers.length);
  const rotation = reorthonormalize(pose.rotation);
  const shift = mat3MulVec3(rotation, centroid);
  const translationMm: Vec3 = [
    pose.translation[0] - shift[0],
    pose.translation[1] - shift[1],
    pose.translation[2] - shift[2],
  ];
  if (!Number.isFinite(rms) || !rotation.every(Number.isFinite) || !translationMm.every(Number.isFinite)) {
    return { ok: false, reason: 'no-solution' };
  }
  return { ok: true, rotation, translationMm, rmsReprojectionPx: rms, inlierIndices: inliers, iterations };
}

interface Problem {
  /** Model points centred on the weighted centroid, x, y, z per point. */
  readonly model: Float64Array;
  readonly pixels: Float64Array;
  /** Normalized to mean 1 over the active points. */
  readonly weights: Float64Array;
  readonly intrinsics: CameraIntrinsics;
  readonly huber: number;
}

type Settings = typeof DEFAULTS;

function resolveSettings(options: SolveHeadPoseOptions): Settings | null {
  const settings: Settings = {
    huberScalePx: options.huberScalePx ?? DEFAULTS.huberScalePx,
    rejectOutliers: options.rejectOutliers ?? DEFAULTS.rejectOutliers,
    outlierMadMultiple: options.outlierMadMultiple ?? DEFAULTS.outlierMadMultiple,
    minOutlierThresholdPx: options.minOutlierThresholdPx ?? DEFAULTS.minOutlierThresholdPx,
    maxIterations: options.maxIterations ?? DEFAULTS.maxIterations,
  };
  const positive = [settings.huberScalePx, settings.outlierMadMultiple, settings.minOutlierThresholdPx];
  if (!positive.every((value) => Number.isFinite(value) && value > 0)) return null;
  if (!Number.isInteger(settings.maxIterations) || settings.maxIterations < 1) return null;
  return settings;
}

/** Variances along the principal axes of the given points, ascending. */
function principalVariances(points: Float64Array, indices: readonly number[], dims: 2 | 3): Float64Array {
  const mean = new Float64Array(dims);
  for (const i of indices) for (let d = 0; d < dims; d++) mean[d] += points[dims * i + d] / indices.length;
  const covariance = new Float64Array(dims * dims);
  for (const i of indices) {
    for (let r = 0; r < dims; r++) {
      for (let c = 0; c < dims; c++) {
        const product = (points[dims * i + r] - mean[r]) * (points[dims * i + c] - mean[c]);
        covariance[r * dims + c] += product / indices.length;
      }
    }
  }
  return symmetricEigen(covariance, dims).values;
}

/** Huber: quadratic up to the scale, linear beyond, so gross errors pull with bounded force. */
function huberLoss(squaredNorm: number, scale: number): number {
  return squaredNorm <= scale * scale ? squaredNorm : 2 * scale * Math.sqrt(squaredNorm) - scale * scale;
}

function huberWeight(squaredNorm: number, scale: number): number {
  return squaredNorm <= scale * scale ? 1 : scale / Math.sqrt(squaredNorm);
}

function weightedHuberCost(problem: Problem, indices: readonly number[], pose: RigidPose): number {
  const { model, pixels, weights, intrinsics, huber } = problem;
  const r = pose.rotation;
  const t = pose.translation;
  let cost = 0;
  for (const i of indices) {
    const x = model[3 * i];
    const y = model[3 * i + 1];
    const z = model[3 * i + 2];
    const cz = r[6] * x + r[7] * y + r[8] * z + t[2];
    if (!(cz > 0)) return Number.POSITIVE_INFINITY;
    const ex = intrinsics.fx * ((r[0] * x + r[1] * y + r[2] * z + t[0]) / cz) + intrinsics.cx - pixels[2 * i];
    const ey = intrinsics.fy * ((r[3] * x + r[4] * y + r[5] * z + t[1]) / cz) + intrinsics.cy - pixels[2 * i + 1];
    cost += weights[i] * huberLoss(ex * ex + ey * ey, huber);
  }
  return Number.isFinite(cost) ? cost : Number.POSITIVE_INFINITY;
}

function residualNorms(problem: Problem, indices: readonly number[], pose: RigidPose): Float64Array {
  const { model, pixels, intrinsics } = problem;
  const r = pose.rotation;
  const t = pose.translation;
  const norms = new Float64Array(indices.length);
  indices.forEach((i, k) => {
    const x = model[3 * i];
    const y = model[3 * i + 1];
    const z = model[3 * i + 2];
    const cz = r[6] * x + r[7] * y + r[8] * z + t[2];
    if (!(cz > 0)) {
      norms[k] = Number.POSITIVE_INFINITY;
      return;
    }
    const ex = intrinsics.fx * ((r[0] * x + r[1] * y + r[2] * z + t[0]) / cz) + intrinsics.cx - pixels[2 * i];
    const ey = intrinsics.fy * ((r[3] * x + r[4] * y + r[5] * z + t[1]) / cz) + intrinsics.cy - pixels[2 * i + 1];
    norms[k] = Math.hypot(ex, ey);
  });
  return norms;
}

/**
 * Levenberg-Marquardt on the weighted Huber reprojection cost. The update is
 * R <- exp(dw) R and t <- t + dt, with Marquardt's diagonal damping so
 * radians and millimetres need no manual scaling. Past the Huber scale the
 * cost grows linearly in the residual norm and has no curvature along the
 * residual direction, so that direction is removed from the point's
 * Gauss-Newton term. Plain reweighting keeps it, overstates the curvature and
 * converges only linearly.
 */
function refinePose(
  problem: Problem,
  indices: readonly number[],
  start: RigidPose,
  maxIterations: number,
): { pose: RigidPose; iterations: number } {
  const { model, pixels, weights, intrinsics, huber } = problem;
  const { fx, fy, cx, cy } = intrinsics;
  let pose = start;
  let cost = weightedHuberCost(problem, indices, pose);
  let lambda = 1e-3;
  const h = new Float64Array(36);
  const g = new Float64Array(6);
  const damped = new Float64Array(36);
  const jx = new Float64Array(6);
  const jy = new Float64Array(6);
  const je = new Float64Array(6);
  let iterations = 0;

  while (iterations < maxIterations && Number.isFinite(cost)) {
    iterations++;
    h.fill(0);
    g.fill(0);
    const r = pose.rotation;
    const t = pose.translation;
    for (const i of indices) {
      const px = model[3 * i];
      const py = model[3 * i + 1];
      const pz = model[3 * i + 2];
      const qx = r[0] * px + r[1] * py + r[2] * pz;
      const qy = r[3] * px + r[4] * py + r[5] * pz;
      const qz = r[6] * px + r[7] * py + r[8] * pz;
      const X = qx + t[0];
      const Y = qy + t[1];
      const Z = qz + t[2];
      const invZ = 1 / Z;
      const ex = fx * X * invZ + cx - pixels[2 * i];
      const ey = fy * Y * invZ + cy - pixels[2 * i + 1];
      const squaredNorm = ex * ex + ey * ey;
      const w = weights[i] * huberWeight(squaredNorm, huber);
      // Unit residual direction for points on the linear branch of the loss, zero otherwise.
      const linear = squaredNorm > huber * huber;
      const nx = linear ? ex / Math.sqrt(squaredNorm) : 0;
      const ny = linear ? ey / Math.sqrt(squaredNorm) : 0;
      // d(pixel)/d(camera point)
      const ux = fx * invZ;
      const uz = -fx * X * invZ * invZ;
      const vy = fy * invZ;
      const vz = -fy * Y * invZ * invZ;
      // d(camera point)/d(dw) = -[q]x, so columns for dw_x, dw_y, dw_z.
      jx[0] = uz * qy;
      jx[1] = ux * qz - uz * qx;
      jx[2] = -ux * qy;
      jx[3] = ux;
      jx[4] = 0;
      jx[5] = uz;
      jy[0] = -vy * qz + vz * qy;
      jy[1] = -vz * qx;
      jy[2] = vy * qx;
      jy[3] = 0;
      jy[4] = vy;
      jy[5] = vz;
      for (let a = 0; a < 6; a++) je[a] = jx[a] * nx + jy[a] * ny;
      for (let a = 0; a < 6; a++) {
        g[a] += w * (jx[a] * ex + jy[a] * ey);
        for (let b = a; b < 6; b++) h[a * 6 + b] += w * (jx[a] * jx[b] + jy[a] * jy[b] - je[a] * je[b]);
      }
    }
    for (let a = 0; a < 6; a++) for (let b = 0; b < a; b++) h[a * 6 + b] = h[b * 6 + a];
    let maxDiag = 0;
    for (let a = 0; a < 6; a++) maxDiag = Math.max(maxDiag, h[a * 7]);
    if (!(maxDiag > 0) || !Number.isFinite(maxDiag)) break;

    let accepted = false;
    let converged = false;
    while (lambda < 1e12) {
      damped.set(h);
      for (let a = 0; a < 6; a++) damped[a * 7] += lambda * Math.max(h[a * 7], 1e-12 * maxDiag);
      const step = solveCholesky(damped, g, 6);
      if (!step) {
        lambda *= 10;
        continue;
      }
      const rotationStep: Vec3 = [-step[0], -step[1], -step[2]];
      const candidate: RigidPose = {
        rotation: mat3Multiply(rotationMatrixFromVector(rotationStep), r),
        translation: [t[0] - step[3], t[1] - step[4], t[2] - step[5]],
      };
      const candidateCost = weightedHuberCost(problem, indices, candidate);
      if (candidateCost < cost) {
        const rotationStepSize = Math.hypot(step[0], step[1], step[2]);
        const translationStepSize = Math.hypot(step[3], step[4], step[5]);
        converged =
          cost - candidateCost <= 1e-12 * cost ||
          (rotationStepSize < 1e-15 && translationStepSize < 1e-13 * (1 + Math.hypot(t[0], t[1], t[2])));
        pose = candidate;
        cost = candidateCost;
        lambda = Math.max(lambda / 10, 1e-9);
        accepted = true;
        break;
      }
      lambda *= 10;
    }
    if (!accepted || converged) break;
  }
  return { pose, iterations };
}

/**
 * Rejection rounds on an equal-weight copy of the problem: refine on the
 * current inliers, then reselect from all active points by residual. Under the
 * landmark weights five points carry over half the weight, so a few shifted
 * heavy points drag the fit toward themselves and keep their own residuals
 * below the threshold. With equal weights no small group controls the fit,
 * and every residual is tested against the same noise level.
 */
function rejectWithEqualWeights(
  problem: Problem,
  active: readonly number[],
  start: RigidPose,
  settings: Settings,
): { inliers: readonly number[]; pose: RigidPose; iterations: number } {
  const equalWeights = new Float64Array(problem.weights.length);
  for (const i of active) equalWeights[i] = 1;
  const equal: Problem = { ...problem, weights: equalWeights };
  let inliers = active;
  let pose = start;
  let iterations = 0;
  // A point near the threshold can flip in and out; stop when a set repeats.
  const seenInlierSets = new Set<string>([inliers.join(',')]);
  for (let round = 0; round < MAX_REJECTION_ROUNDS; round++) {
    const refined = refinePose(equal, inliers, pose, settings.maxIterations);
    pose = refined.pose;
    iterations += refined.iterations;
    const next = selectInliers(equal, active, pose, settings);
    const key = next.join(',');
    if (seenInlierSets.has(key)) break;
    seenInlierSets.add(key);
    inliers = next;
  }
  return { inliers, pose, iterations };
}

/**
 * Inliers are points whose residual is at most
 * max(median + k * 1.4826 * MAD, floor). The threshold is at least the
 * median, so at most half the points are dropped per round.
 */
function selectInliers(problem: Problem, active: readonly number[], pose: RigidPose, settings: Settings): number[] {
  if (active.length <= MIN_INLIERS_AFTER_REJECTION) return [...active];
  const norms = residualNorms(problem, active, pose);
  const median = medianOf(norms);
  const mad = medianOf(norms.map((norm) => Math.abs(norm - median)));
  const threshold = Math.max(median + settings.outlierMadMultiple * MAD_TO_SIGMA * mad, settings.minOutlierThresholdPx);
  const order = active.map((_, k) => k).sort((a, b) => norms[a] - norms[b]);
  const kept = order.filter((k, rank) => norms[k] <= threshold || rank < MIN_INLIERS_AFTER_REJECTION);
  return kept.map((k) => active[k]).sort((a, b) => a - b);
}

function medianOf(values: Float64Array): number {
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}
