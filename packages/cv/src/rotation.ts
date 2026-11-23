import { mat3Determinant, mat3Multiply, mat3Transpose, type Mat3, type Vec3 } from './linalg.ts';

/** Unit quaternion, Hamilton convention, w is the scalar part. */
export interface Quaternion {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Below this rotation angle (radians) the exp and log maps use Taylor series. */
const SMALL_ANGLE = 1e-4;

/** Shepperd's method: picks the largest of w, x, y, z to divide by. Returns w >= 0. */
export function quaternionFromMatrix(m: Mat3): Quaternion {
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = m;
  const trace = r00 + r11 + r22;
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    w = s / 4;
    x = (r21 - r12) / s;
    y = (r02 - r20) / s;
    z = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
    w = (r21 - r12) / s;
    x = s / 4;
    y = (r01 + r10) / s;
    z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
    w = (r02 - r20) / s;
    x = (r01 + r10) / s;
    y = s / 4;
    z = (r12 + r21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
    w = (r10 - r01) / s;
    x = (r02 + r20) / s;
    y = (r12 + r21) / s;
    z = s / 4;
  }
  const sign = w < 0 ? -1 : 1;
  const norm = Math.hypot(w, x, y, z) * sign;
  return { w: w / norm, x: x / norm, y: y / norm, z: z / norm };
}

/** Rotation matrix of a quaternion. The input is normalized first. */
export function matrixFromQuaternion(q: Quaternion): Mat3 {
  const norm = Math.hypot(q.w, q.x, q.y, q.z);
  const w = q.w / norm;
  const x = q.x / norm;
  const y = q.y / norm;
  const z = q.z / norm;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

export function quaternionMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function quaternionConjugate(q: Quaternion): Quaternion {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

/** Exp map: rotation by |v| radians about v / |v|. */
export function quaternionFromRotationVector(v: Vec3): Quaternion {
  const theta = Math.hypot(v[0], v[1], v[2]);
  const k = theta < SMALL_ANGLE ? 0.5 - (theta * theta) / 48 : Math.sin(theta / 2) / theta;
  return { w: Math.cos(theta / 2), x: k * v[0], y: k * v[1], z: k * v[2] };
}

/** Log map: rotation vector with angle in [0, pi]. */
export function rotationVectorFromQuaternion(q: Quaternion): Vec3 {
  const sign = q.w < 0 ? -1 : 1;
  const w = q.w * sign;
  const x = q.x * sign;
  const y = q.y * sign;
  const z = q.z * sign;
  const s = Math.hypot(x, y, z);
  const theta = 2 * Math.atan2(s, w);
  const k = theta < SMALL_ANGLE ? (2 / w) * (1 - (s * s) / (3 * w * w)) : theta / s;
  return [k * x, k * y, k * z];
}

export function rotationMatrixFromVector(v: Vec3): Mat3 {
  return matrixFromQuaternion(quaternionFromRotationVector(v));
}

export function rotationVectorFromMatrix(m: Mat3): Vec3 {
  return rotationVectorFromQuaternion(quaternionFromMatrix(m));
}

/**
 * Angle in [0, pi] of the relative rotation a^T b. Uses atan2 of the skew and
 * trace parts so small angles keep full precision.
 */
export function angleBetweenRotations(a: Mat3, b: Mat3): number {
  const m = mat3Multiply(mat3Transpose(a), b);
  const sin = 0.5 * Math.hypot(m[7] - m[5], m[2] - m[6], m[3] - m[1]);
  const cos = 0.5 * (m[0] + m[4] + m[8] - 1);
  return Math.atan2(sin, cos);
}

export function angleBetweenQuaternions(a: Quaternion, b: Quaternion): number {
  const r = quaternionMultiply(quaternionConjugate(a), b);
  return 2 * Math.atan2(Math.hypot(r.x, r.y, r.z), Math.abs(r.w));
}

/** Projects a nearly orthonormal matrix back onto SO(3) through its quaternion. */
export function reorthonormalize(m: Mat3): Mat3 {
  return matrixFromQuaternion(quaternionFromMatrix(m));
}

export function isRotationMatrix(m: Mat3, tolerance = 1e-6): boolean {
  if (!m.every(Number.isFinite)) return false;
  const mtm = mat3Multiply(mat3Transpose(m), m);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (Math.abs(mtm[i * 3 + j] - (i === j ? 1 : 0)) > tolerance) return false;
    }
  }
  return Math.abs(mat3Determinant(m) - 1) <= tolerance;
}
