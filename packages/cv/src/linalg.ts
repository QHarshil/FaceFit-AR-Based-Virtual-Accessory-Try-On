export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

/** Row-major 3x3 matrix. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function mat3Transpose(a: Mat3): Mat3 {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

export function mat3MulVec3(a: Mat3, v: Vec3): Vec3 {
  return [
    a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
    a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
    a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
  ];
}

export function mat3Determinant(a: Mat3): number {
  return (
    a[0] * (a[4] * a[8] - a[5] * a[7]) -
    a[1] * (a[3] * a[8] - a[5] * a[6]) +
    a[2] * (a[3] * a[7] - a[4] * a[6])
  );
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vec3Norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export interface SymmetricEigen {
  /** Eigenvalues in ascending order. */
  readonly values: Float64Array;
  /** Row k holds the unit eigenvector for values[k]. */
  readonly vectors: Float64Array;
}

/**
 * Cyclic Jacobi eigendecomposition of a symmetric n x n row-major matrix.
 * Jacobi keeps small eigenvalues accurate relative to their size, which
 * EPnP needs for its null-space vectors. Off-diagonal entries are skipped
 * once they are below machine epsilon relative to their diagonal pair.
 */
export function symmetricEigen(matrix: ArrayLike<number>, n: number): SymmetricEigen {
  const a = Float64Array.from(matrix);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;

  for (let sweep = 0; sweep < 60; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        const app = a[p * n + p];
        const aqq = a[q * n + q];
        if (Math.abs(apq) <= Number.EPSILON * Math.sqrt(Math.abs(app * aqq)) || apq === 0) continue;
        rotated = true;
        const theta = (aqq - app) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p];
          const akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k];
          const aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p];
          const vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
    if (!rotated) break;
  }

  const order = Array.from({ length: n }, (_, i) => i).sort(
    (i, j) => a[i * n + i] - a[j * n + j],
  );
  const values = new Float64Array(n);
  const vectors = new Float64Array(n * n);
  order.forEach((col, k) => {
    values[k] = a[col * n + col];
    for (let i = 0; i < n; i++) vectors[k * n + i] = v[i * n + col];
  });
  return { values, vectors };
}

/**
 * Solves A x = b for a symmetric positive definite n x n matrix by Cholesky.
 * Returns null when A is not numerically positive definite.
 */
export function solveCholesky(matrix: ArrayLike<number>, rhs: ArrayLike<number>, n: number): Float64Array | null {
  const l = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let diag = matrix[j * n + j];
    for (let k = 0; k < j; k++) diag -= l[j * n + k] ** 2;
    if (!(diag > 0) || !Number.isFinite(diag)) return null;
    const ljj = Math.sqrt(diag);
    l[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let sum = matrix[i * n + j];
      for (let k = 0; k < j; k++) sum -= l[i * n + k] * l[j * n + k];
      l[i * n + j] = sum / ljj;
    }
  }
  const x = Float64Array.from(rhs);
  for (let i = 0; i < n; i++) {
    let sum = x[i];
    for (let k = 0; k < i; k++) sum -= l[i * n + k] * x[k];
    x[i] = sum / l[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i];
    for (let k = i + 1; k < n; k++) sum -= l[k * n + i] * x[k];
    x[i] = sum / l[i * n + i];
  }
  return x;
}

/**
 * Least-squares solution of the rows x cols system A x = b (rows >= cols) by
 * Householder QR. Returns null when A is numerically rank deficient.
 */
export function solveLeastSquares(
  matrix: ArrayLike<number>,
  rhs: ArrayLike<number>,
  rows: number,
  cols: number,
): Float64Array | null {
  const a = Float64Array.from(matrix);
  const b = Float64Array.from(rhs);
  let scale = 0;
  for (let i = 0; i < a.length; i++) scale = Math.max(scale, Math.abs(a[i]));
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const rankTolerance = scale * Math.max(rows, cols) * 1e-12;

  for (let k = 0; k < cols; k++) {
    let norm = 0;
    for (let i = k; i < rows; i++) norm = Math.hypot(norm, a[i * cols + k]);
    if (norm <= rankTolerance) return null;
    const akk = a[k * cols + k];
    const alpha = akk > 0 ? -norm : norm;
    // Householder vector u = x - alpha e1, stored in column k below the diagonal.
    a[k * cols + k] = akk - alpha;
    let uNormSq = 0;
    for (let i = k; i < rows; i++) uNormSq += a[i * cols + k] ** 2;
    for (let j = k + 1; j < cols; j++) {
      let dot = 0;
      for (let i = k; i < rows; i++) dot += a[i * cols + k] * a[i * cols + j];
      const f = (2 * dot) / uNormSq;
      for (let i = k; i < rows; i++) a[i * cols + j] = a[i * cols + j] - f * a[i * cols + k];
    }
    let dotB = 0;
    for (let i = k; i < rows; i++) dotB += a[i * cols + k] * b[i];
    const fb = (2 * dotB) / uNormSq;
    for (let i = k; i < rows; i++) b[i] = b[i] - fb * a[i * cols + k];
    a[k * cols + k] = alpha;
  }

  const x = new Float64Array(cols);
  for (let i = cols - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < cols; j++) sum -= a[i * cols + j] * x[j];
    x[i] = sum / a[i * cols + i];
  }
  return x;
}
