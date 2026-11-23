import { describe, expect, it } from 'vitest';
import { mat3MulVec3, mat3Multiply, type Mat3, type Vec3 } from '../src/linalg.ts';
import {
  angleBetweenQuaternions,
  angleBetweenRotations,
  isRotationMatrix,
  matrixFromQuaternion,
  quaternionFromMatrix,
  quaternionMultiply,
  rotationMatrixFromVector,
  rotationVectorFromMatrix,
} from '../src/rotation.ts';
import { seededRandom, type SeededRandom } from './random.ts';

function randomUnitVector(random: SeededRandom): Vec3 {
  for (;;) {
    const v: Vec3 = [random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1)];
    const norm = Math.hypot(...v);
    if (norm > 0.1 && norm <= 1) return [v[0] / norm, v[1] / norm, v[2] / norm];
  }
}

function scaled(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

/** Independent reference: Rodrigues' rotation formula applied to a vector. */
function rodrigues(axis: Vec3, angle: number, p: Vec3): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dot = axis[0] * p[0] + axis[1] * p[1] + axis[2] * p[2];
  const cross: Vec3 = [axis[1] * p[2] - axis[2] * p[1], axis[2] * p[0] - axis[0] * p[2], axis[0] * p[1] - axis[1] * p[0]];
  const component = (i: 0 | 1 | 2): number => p[i] * c + cross[i] * s + axis[i] * dot * (1 - c);
  return [component(0), component(1), component(2)];
}

describe('rotation vector exp and log maps', () => {
  it('match Rodrigues formula on random axes and angles', () => {
    const random = seededRandom(11);
    for (let trial = 0; trial < 500; trial++) {
      const axis = randomUnitVector(random);
      const angle = random.uniform(0, Math.PI);
      const r = rotationMatrixFromVector(scaled(axis, angle));
      const p: Vec3 = [random.uniform(-100, 100), random.uniform(-100, 100), random.uniform(-100, 100)];
      const expected = rodrigues(axis, angle, p);
      const actual = mat3MulVec3(r, p);
      for (let i = 0; i < 3; i++) expect(Math.abs(actual[i] - expected[i])).toBeLessThan(1e-12);
    }
  });

  it('round-trip from the identity up to just below pi', () => {
    const random = seededRandom(12);
    const angles = [0, 1e-14, 1e-9, 1e-5, 9e-5, 1.1e-4, 0.5, 2, 3, Math.PI - 1e-6];
    for (const angle of angles) {
      for (let trial = 0; trial < 20; trial++) {
        const v = scaled(randomUnitVector(random), angle);
        const back = rotationVectorFromMatrix(rotationMatrixFromVector(v));
        // Absolute error near round-off of a unit-scale matrix; relative for tiny angles.
        const tolerance = Math.max(1e-12 * angle, 1e-15) + (angle > 3 ? 1e-9 : 0);
        for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - v[i])).toBeLessThanOrEqual(tolerance);
      }
    }
  });
});

describe('quaternion and matrix conversions', () => {
  it('round-trip through every branch of Shepperd method', () => {
    const random = seededRandom(13);
    for (let trial = 0; trial < 500; trial++) {
      // Angles near pi about each axis exercise the negative-trace branches.
      const angle = trial % 2 === 0 ? random.uniform(0, Math.PI) : random.uniform(Math.PI - 0.3, Math.PI);
      const r = rotationMatrixFromVector(scaled(randomUnitVector(random), angle));
      const q = quaternionFromMatrix(r);
      expect(q.w).toBeGreaterThanOrEqual(0);
      expect(Math.abs(Math.hypot(q.w, q.x, q.y, q.z) - 1)).toBeLessThan(1e-14);
      const back = matrixFromQuaternion(q);
      for (let i = 0; i < 9; i++) expect(Math.abs(back[i] - r[i])).toBeLessThan(1e-14);
      expect(isRotationMatrix(back, 1e-12)).toBe(true);
    }
  });

  it('compose quaternions like matrices', () => {
    const random = seededRandom(14);
    for (let trial = 0; trial < 200; trial++) {
      const a = rotationMatrixFromVector(scaled(randomUnitVector(random), random.uniform(0, Math.PI)));
      const b = rotationMatrixFromVector(scaled(randomUnitVector(random), random.uniform(0, Math.PI)));
      const composed = matrixFromQuaternion(quaternionMultiply(quaternionFromMatrix(a), quaternionFromMatrix(b)));
      const expected = mat3Multiply(a, b);
      for (let i = 0; i < 9; i++) expect(Math.abs(composed[i] - expected[i])).toBeLessThan(1e-14);
    }
  });
});

describe('angle between rotations', () => {
  it('equals the magnitude of the relative rotation vector, including tiny and near-pi angles', () => {
    const random = seededRandom(15);
    for (const angle of [0, 1e-12, 1e-8, 1e-3, 0.7, 2.5, Math.PI - 1e-4]) {
      const base = rotationMatrixFromVector(scaled(randomUnitVector(random), random.uniform(0, Math.PI)));
      const delta = rotationMatrixFromVector(scaled(randomUnitVector(random), angle));
      const other = mat3Multiply(base, delta);
      const tolerance = Math.max(1e-12 * angle, 1e-15) + (angle > 3 ? 1e-8 : 0);
      expect(Math.abs(angleBetweenRotations(base, other) - angle)).toBeLessThanOrEqual(tolerance);
      expect(
        Math.abs(angleBetweenQuaternions(quaternionFromMatrix(base), quaternionFromMatrix(other)) - angle),
      ).toBeLessThanOrEqual(tolerance + 1e-15);
    }
  });
});

describe('isRotationMatrix', () => {
  it('rejects reflections, scaling and non-finite entries', () => {
    const reflection: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, -1];
    const scaledIdentity: Mat3 = [1.01, 0, 0, 0, 1.01, 0, 0, 0, 1.01];
    const withNaN: Mat3 = [Number.NaN, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(isRotationMatrix(reflection)).toBe(false);
    expect(isRotationMatrix(scaledIdentity)).toBe(false);
    expect(isRotationMatrix(withNaN)).toBe(false);
  });
});
