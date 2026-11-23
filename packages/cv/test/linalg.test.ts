import { describe, expect, it } from 'vitest';
import { solveCholesky, solveLeastSquares, symmetricEigen } from '../src/linalg.ts';
import { seededRandom } from './random.ts';

function randomSymmetric(n: number, seed: number): Float64Array {
  const random = seededRandom(seed);
  const m = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const value = random.uniform(-5, 5);
      m[i * n + j] = value;
      m[j * n + i] = value;
    }
  }
  return m;
}

describe('symmetricEigen', () => {
  it.each([3, 4, 9, 12])('diagonalizes a random %i x %i symmetric matrix', (n) => {
    const m = randomSymmetric(n, n);
    const { values, vectors } = symmetricEigen(m, n);
    for (let k = 1; k < n; k++) expect(values[k]!).toBeGreaterThanOrEqual(values[k - 1]!);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        let mv = 0;
        for (let j = 0; j < n; j++) mv += m[i * n + j]! * vectors[k * n + j]!;
        expect(Math.abs(mv - values[k]! * vectors[k * n + i]!)).toBeLessThan(1e-12);
      }
      for (let l = 0; l < n; l++) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += vectors[k * n + i]! * vectors[l * n + i]!;
        expect(Math.abs(dot - (k === l ? 1 : 0))).toBeLessThan(1e-12);
      }
    }
  });

  it('recovers the exact null vector of B^T B, as EPnP needs', () => {
    const random = seededRandom(3);
    const rows = 24;
    const n = 12;
    const z = Array.from({ length: n }, () => random.uniform(-1, 1));
    const zNorm = Math.hypot(...z);
    const unitZ = z.map((value) => value / zNorm);
    const b = Array.from({ length: rows * n }, () => random.uniform(-1, 1));
    for (let r = 0; r < rows; r++) {
      let dot = 0;
      for (let j = 0; j < n; j++) dot += b[r * n + j]! * unitZ[j]!;
      for (let j = 0; j < n; j++) b[r * n + j] = b[r * n + j]! - dot * unitZ[j]!;
    }
    const btb = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        for (let r = 0; r < rows; r++) btb[i * n + j] = btb[i * n + j]! + b[r * n + i]! * b[r * n + j]!;
      }
    }
    const { values, vectors } = symmetricEigen(btb, n);
    let alignment = 0;
    for (let j = 0; j < n; j++) alignment += vectors[j]! * unitZ[j]!;
    expect(Math.abs(values[0]!)).toBeLessThan(1e-12);
    expect(1 - Math.abs(alignment)).toBeLessThan(1e-12);
  });
});

describe('solveCholesky', () => {
  it('solves a positive definite system', () => {
    const a = [4, 2, 0.6, 2, 5, 1, 0.6, 1, 3];
    const x = [1, -2, 0.5];
    const b = [0, 1, 2].map((i) => a[i * 3]! * x[0]! + a[i * 3 + 1]! * x[1]! + a[i * 3 + 2]! * x[2]!);
    const solved = solveCholesky(a, b, 3)!;
    for (let i = 0; i < 3; i++) expect(solved[i]!).toBeCloseTo(x[i]!, 12);
  });

  it('returns null for an indefinite matrix', () => {
    expect(solveCholesky([1, 2, 2, 1], [1, 1], 2)).toBeNull();
  });
});

describe('solveLeastSquares', () => {
  it('matches the normal-equation solution of an overdetermined system', () => {
    const random = seededRandom(7);
    const rows = 6;
    const cols = 4;
    const a = Array.from({ length: rows * cols }, () => random.uniform(-1, 1));
    const b = Array.from({ length: rows }, () => random.uniform(-1, 1));
    const x = solveLeastSquares(a, b, rows, cols)!;
    // The residual is orthogonal to the column space at the optimum.
    for (let j = 0; j < cols; j++) {
      let dot = 0;
      for (let i = 0; i < rows; i++) {
        let ax = 0;
        for (let k = 0; k < cols; k++) ax += a[i * cols + k]! * x[k]!;
        dot += a[i * cols + j]! * (ax - b[i]!);
      }
      expect(Math.abs(dot)).toBeLessThan(1e-12);
    }
  });

  it('returns null for a rank-deficient matrix', () => {
    expect(solveLeastSquares([1, 2, 2, 4, 3, 6], [1, 2, 3], 3, 2)).toBeNull();
    expect(solveLeastSquares([0, 0, 0, 0], [1, 2], 2, 2)).toBeNull();
  });
});
