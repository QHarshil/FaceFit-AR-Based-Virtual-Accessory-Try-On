import { mat3MulVec3, solveLeastSquares, symmetricEigen, type Mat3, type Vec3 } from './linalg.ts';
import { matrixFromQuaternion } from './rotation.ts';

export interface RigidPose {
  readonly rotation: Mat3;
  readonly translation: Vec3;
}

/** Index pairs of the four control points, in the row order of L and rho. */
const CONTROL_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

/**
 * EPnP (Lepetit, Moreno-Noguer and Fua, IJCV 2009) on normalized image
 * coordinates, with each point's two equations scaled by sqrt(weight).
 * Expects non-coplanar model points; the caller checks that. Returns null
 * when no beta approximation yields a finite pose.
 *
 * @param model    x, y, z per point
 * @param image    normalized (x / z, y / z) per point
 * @param weights  non-negative weight per point
 * @param indices  points to use
 */
export function solveEpnp(
  model: Float64Array,
  image: Float64Array,
  weights: Float64Array,
  indices: readonly number[],
): RigidPose | null {
  const n = indices.length;
  const control = chooseControlPoints(model, indices);
  if (!control) return null;
  const alphas = barycentricCoordinates(model, indices, control);

  const mtm = new Float64Array(144);
  const rowX = new Float64Array(12);
  const rowY = new Float64Array(12);
  for (let k = 0; k < n; k++) {
    const i = indices[k];
    const w = weights[i];
    const u = image[2 * i];
    const v = image[2 * i + 1];
    for (let j = 0; j < 4; j++) {
      const a = alphas[4 * k + j];
      rowX[3 * j] = a;
      rowX[3 * j + 1] = 0;
      rowX[3 * j + 2] = -a * u;
      rowY[3 * j] = 0;
      rowY[3 * j + 1] = a;
      rowY[3 * j + 2] = -a * v;
    }
    for (let r = 0; r < 12; r++) {
      for (let c = r; c < 12; c++) mtm[r * 12 + c] = mtm[r * 12 + c] + w * (rowX[r] * rowX[c] + rowY[r] * rowY[c]);
    }
  }
  for (let r = 0; r < 12; r++) for (let c = 0; c < r; c++) mtm[r * 12 + c] = mtm[c * 12 + r];

  const { vectors } = symmetricEigen(mtm, 12);
  // The four eigenvectors with the smallest eigenvalues span the solution space.
  const nullVectors = [0, 1, 2, 3].map((k) => vectors.subarray(k * 12, k * 12 + 12));
  const { l, rho } = distanceConstraints(nullVectors, control);

  let best: RigidPose | null = null;
  let bestError = Number.POSITIVE_INFINITY;
  for (const initialBetas of [betasApprox1(l, rho), betasApprox2(l, rho), betasApprox3(l, rho)]) {
    if (!initialBetas) continue;
    const betas = refineBetas(l, rho, initialBetas);
    const pose = poseFromBetas(model, indices, weights, alphas, nullVectors, betas);
    if (!pose) continue;
    const error = reprojectionError(model, image, weights, indices, pose);
    if (error < bestError) {
      bestError = error;
      best = pose;
    }
  }
  return best;
}

/** Centroid plus the principal axes scaled by their standard deviation. */
function chooseControlPoints(model: Float64Array, indices: readonly number[]): Float64Array | null {
  const n = indices.length;
  const control = new Float64Array(12);
  for (const i of indices) for (let d = 0; d < 3; d++) control[d] = control[d] + model[3 * i + d] / n;
  const covariance = new Float64Array(9);
  for (const i of indices) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        covariance[r * 3 + c] =
          covariance[r * 3 + c] + (model[3 * i + r] - control[r]) * (model[3 * i + c] - control[c]);
      }
    }
  }
  const { values, vectors } = symmetricEigen(covariance, 3);
  for (let k = 0; k < 3; k++) {
    const scale = Math.sqrt(values[k] / n);
    if (!(scale > 0)) return null;
    for (let d = 0; d < 3; d++) control[3 * (k + 1) + d] = control[d] + scale * vectors[k * 3 + d];
  }
  return control;
}

function barycentricCoordinates(model: Float64Array, indices: readonly number[], control: Float64Array): Float64Array {
  // Control axes are orthogonal, so each coordinate is a projection divided by the squared axis length.
  const axes = [1, 2, 3].map((j) => [0, 1, 2].map((d) => control[3 * j + d] - control[d]));
  const axisLengthSq = axes.map((axis) => axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2);
  const alphas = new Float64Array(4 * indices.length);
  indices.forEach((i, k) => {
    let sum = 0;
    for (let j = 0; j < 3; j++) {
      const axis = axes[j];
      let dot = 0;
      for (let d = 0; d < 3; d++) dot += axis[d] * (model[3 * i + d] - control[d]);
      const alpha = dot / axisLengthSq[j];
      alphas[4 * k + j + 1] = alpha;
      sum += alpha;
    }
    alphas[4 * k] = 1 - sum;
  });
  return alphas;
}

/**
 * Rows of L hold the coefficients of the beta products
 * [b11, b12, b22, b13, b23, b33, b14, b24, b34, b44] in the squared distance
 * between two camera-frame control points; rho holds the model distances.
 */
function distanceConstraints(
  nullVectors: readonly Float64Array[],
  control: Float64Array,
): { l: Float64Array; rho: Float64Array } {
  const l = new Float64Array(60);
  const rho = new Float64Array(6);
  CONTROL_PAIRS.forEach(([a, b], row) => {
    const dv = nullVectors.map((v) => [0, 1, 2].map((d) => v[3 * a + d] - v[3 * b + d]));
    const dot = (p: number, q: number): number =>
      dv[p][0] * dv[q][0] + dv[p][1] * dv[q][1] + dv[p][2] * dv[q][2];
    const coefficients = [
      dot(0, 0),
      2 * dot(0, 1),
      dot(1, 1),
      2 * dot(0, 2),
      2 * dot(1, 2),
      dot(2, 2),
      2 * dot(0, 3),
      2 * dot(1, 3),
      2 * dot(2, 3),
      dot(3, 3),
    ];
    l.set(coefficients, row * 10);
    let distanceSq = 0;
    for (let d = 0; d < 3; d++) distanceSq += (control[3 * a + d] - control[3 * b + d]) ** 2;
    rho[row] = distanceSq;
  });
  return { l, rho };
}

function selectColumns(l: Float64Array, columns: readonly number[]): Float64Array {
  const out = new Float64Array(6 * columns.length);
  for (let r = 0; r < 6; r++) columns.forEach((c, k) => (out[r * columns.length + k] = l[r * 10 + c]));
  return out;
}

/** N = 4 approximation: solve for [b11, b12, b13, b14]. */
function betasApprox1(l: Float64Array, rho: Float64Array): Float64Array | null {
  const b = solveLeastSquares(selectColumns(l, [0, 1, 3, 6]), rho, 6, 4);
  if (!b) return null;
  const sign = b[0] < 0 ? -1 : 1;
  const beta0 = Math.sqrt(Math.abs(b[0]));
  if (!(beta0 > 0)) return null;
  return Float64Array.of(beta0, (sign * b[1]) / beta0, (sign * b[2]) / beta0, (sign * b[3]) / beta0);
}

/** N = 2 approximation: solve for [b11, b12, b22]. */
function betasApprox2(l: Float64Array, rho: Float64Array): Float64Array | null {
  const b = solveLeastSquares(selectColumns(l, [0, 1, 2]), rho, 6, 3);
  if (!b) return null;
  const sign = b[0] < 0 ? -1 : 1;
  let beta0 = Math.sqrt(Math.abs(b[0]));
  const beta1 = sign * b[2] > 0 ? Math.sqrt(sign * b[2]) : 0;
  if (b[1] < 0) beta0 = -beta0;
  return Float64Array.of(beta0, beta1, 0, 0);
}

/** N = 3 approximation: solve for [b11, b12, b22, b13, b23]. */
function betasApprox3(l: Float64Array, rho: Float64Array): Float64Array | null {
  const b = solveLeastSquares(selectColumns(l, [0, 1, 2, 3, 4]), rho, 6, 5);
  if (!b) return null;
  const sign = b[0] < 0 ? -1 : 1;
  let beta0 = Math.sqrt(Math.abs(b[0]));
  const beta1 = sign * b[2] > 0 ? Math.sqrt(sign * b[2]) : 0;
  if (b[1] < 0) beta0 = -beta0;
  if (!(Math.abs(beta0) > 0)) return null;
  return Float64Array.of(beta0, beta1, b[3] / beta0, 0);
}

/** Gauss-Newton on the six distance constraints, as in the reference implementation. */
function refineBetas(l: Float64Array, rho: Float64Array, initial: Float64Array): Float64Array {
  const betas = Float64Array.from(initial);
  const a = new Float64Array(24);
  const residual = new Float64Array(6);
  for (let iteration = 0; iteration < 5; iteration++) {
    const b0 = betas[0];
    const b1 = betas[1];
    const b2 = betas[2];
    const b3 = betas[3];
    const products = [b0 * b0, b0 * b1, b1 * b1, b0 * b2, b1 * b2, b2 * b2, b0 * b3, b1 * b3, b2 * b3, b3 * b3];
    for (let r = 0; r < 6; r++) {
      const row = l.subarray(r * 10, r * 10 + 10);
      a[r * 4] = 2 * row[0] * b0 + row[1] * b1 + row[3] * b2 + row[6] * b3;
      a[r * 4 + 1] = row[1] * b0 + 2 * row[2] * b1 + row[4] * b2 + row[7] * b3;
      a[r * 4 + 2] = row[3] * b0 + row[4] * b1 + 2 * row[5] * b2 + row[8] * b3;
      a[r * 4 + 3] = row[6] * b0 + row[7] * b1 + row[8] * b2 + 2 * row[9] * b3;
      let predicted = 0;
      for (let c = 0; c < 10; c++) predicted += row[c] * products[c];
      residual[r] = rho[r] - predicted;
    }
    const step = solveLeastSquares(a, residual, 6, 4);
    if (!step || !step.every(Number.isFinite)) break;
    for (let k = 0; k < 4; k++) betas[k] = betas[k] + step[k];
  }
  return betas;
}

function poseFromBetas(
  model: Float64Array,
  indices: readonly number[],
  weights: Float64Array,
  alphas: Float64Array,
  nullVectors: readonly Float64Array[],
  betas: Float64Array,
): RigidPose | null {
  const controlCamera = new Float64Array(12);
  for (let k = 0; k < 4; k++) {
    for (let e = 0; e < 12; e++) controlCamera[e] = controlCamera[e] + betas[k] * nullVectors[k][e];
  }
  const n = indices.length;
  const camera = new Float64Array(3 * n);
  let depthSum = 0;
  for (let k = 0; k < n; k++) {
    for (let d = 0; d < 3; d++) {
      let value = 0;
      for (let j = 0; j < 4; j++) value += alphas[4 * k + j] * controlCamera[3 * j + d];
      camera[3 * k + d] = value;
    }
    depthSum += camera[3 * k + 2];
  }
  // The null-space solution has a sign ambiguity; the face is in front of the camera.
  if (depthSum < 0) for (let e = 0; e < camera.length; e++) camera[e] = -camera[e];
  return absoluteOrientation(model, indices, weights, camera);
}

/**
 * Weighted absolute orientation by Horn's quaternion method (JOSA A 1987):
 * the rotation is the top eigenvector of a 4x4 matrix built from the
 * cross-covariance, so it is always proper.
 */
function absoluteOrientation(
  model: Float64Array,
  indices: readonly number[],
  weights: Float64Array,
  camera: Float64Array,
): RigidPose | null {
  let totalWeight = 0;
  const modelCentroid = [0, 0, 0];
  const cameraCentroid = [0, 0, 0];
  indices.forEach((i, k) => {
    const w = weights[i];
    totalWeight += w;
    for (let d = 0; d < 3; d++) {
      modelCentroid[d] = modelCentroid[d] + w * model[3 * i + d];
      cameraCentroid[d] = cameraCentroid[d] + w * camera[3 * k + d];
    }
  });
  if (!(totalWeight > 0)) return null;
  for (let d = 0; d < 3; d++) {
    modelCentroid[d] = modelCentroid[d] / totalWeight;
    cameraCentroid[d] = cameraCentroid[d] / totalWeight;
  }
  const s = new Float64Array(9);
  indices.forEach((i, k) => {
    const w = weights[i];
    for (let r = 0; r < 3; r++) {
      const a = model[3 * i + r] - modelCentroid[r];
      for (let c = 0; c < 3; c++) s[r * 3 + c] = s[r * 3 + c] + w * a * (camera[3 * k + c] - cameraCentroid[c]);
    }
  });
  const [sxx, sxy, sxz, syx, syy, syz, szx, szy, szz] = s;
  const horn = [
    sxx + syy + szz, syz - szy, szx - sxz, sxy - syx,
    syz - szy, sxx - syy - szz, sxy + syx, szx + sxz,
    szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy,
    sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz,
  ];
  const { vectors } = symmetricEigen(horn, 4);
  const q = { w: vectors[12], x: vectors[13], y: vectors[14], z: vectors[15] };
  if (![q.w, q.x, q.y, q.z].every(Number.isFinite)) return null;
  const rotation = matrixFromQuaternion(q);
  const rotatedCentroid = mat3MulVec3(rotation, [modelCentroid[0], modelCentroid[1], modelCentroid[2]]);
  const translation: Vec3 = [
    cameraCentroid[0] - rotatedCentroid[0],
    cameraCentroid[1] - rotatedCentroid[1],
    cameraCentroid[2] - rotatedCentroid[2],
  ];
  if (!translation.every(Number.isFinite) || !rotation.every(Number.isFinite)) return null;
  return { rotation, translation };
}

function reprojectionError(
  model: Float64Array,
  image: Float64Array,
  weights: Float64Array,
  indices: readonly number[],
  pose: RigidPose,
): number {
  const r = pose.rotation;
  const t = pose.translation;
  let error = 0;
  for (const i of indices) {
    const x = model[3 * i];
    const y = model[3 * i + 1];
    const z = model[3 * i + 2];
    const cz = r[6] * x + r[7] * y + r[8] * z + t[2];
    if (!(cz > 0)) return Number.POSITIVE_INFINITY;
    const cx = r[0] * x + r[1] * y + r[2] * z + t[0];
    const cy = r[3] * x + r[4] * y + r[5] * z + t[1];
    error += weights[i] * ((cx / cz - image[2 * i]) ** 2 + (cy / cz - image[2 * i + 1]) ** 2);
  }
  return error;
}
