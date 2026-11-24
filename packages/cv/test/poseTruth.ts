import { mat3Multiply, mat3Transpose, type Mat3, type Vec3 } from '../src/linalg.ts';
import type { HeadPose } from '../src/pnp.ts';
import { rotationMatrixFromVector, rotationVectorFromMatrix } from '../src/rotation.ts';
import type { SeededRandom } from './random.ts';

export const DEG = Math.PI / 180;

/** A face in front of the camera, turned a little so no axis is special. */
export const REST_POSE: HeadPose = {
  rotation: rotationMatrixFromVector([0.1, -0.2, 0.05]),
  translationMm: [20, -10, 600],
};

/** Pose moving at constant angular velocity (camera frame, rad/s) and velocity (mm/s) from `start`. */
export function constantVelocityPose(start: HeadPose, angularVelocity: Vec3, velocityMm: Vec3, seconds: number): HeadPose {
  return {
    rotation: mat3Multiply(rotationMatrixFromVector(scale(angularVelocity, seconds)), start.rotation),
    translationMm: [
      start.translationMm[0] + velocityMm[0] * seconds,
      start.translationMm[1] + velocityMm[1] * seconds,
      start.translationMm[2] + velocityMm[2] * seconds,
    ],
  };
}

/** Measurement of `truth` with isotropic rotation noise (left perturbation) and per-axis translation noise. */
export function noisyPose(truth: HeadPose, random: SeededRandom, rotationSigmaRad: number, translationSigmaMm: Vec3): HeadPose {
  const noise: Vec3 = [random.gaussian(rotationSigmaRad), random.gaussian(rotationSigmaRad), random.gaussian(rotationSigmaRad)];
  return {
    rotation: mat3Multiply(rotationMatrixFromVector(noise), truth.rotation),
    translationMm: [
      truth.translationMm[0] + random.gaussian(translationSigmaMm[0]),
      truth.translationMm[1] + random.gaussian(translationSigmaMm[1]),
      truth.translationMm[2] + random.gaussian(translationSigmaMm[2]),
    ],
  };
}

/** Rotation error of `estimate` against `truth` as a camera-frame rotation vector: log(R R_truth^T). */
export function rotationError(estimate: Mat3, truth: Mat3): Vec3 {
  return rotationVectorFromMatrix(mat3Multiply(estimate, mat3Transpose(truth)));
}

export function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function standardDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
}

/** Frame times starting at 0 with the given intervals in milliseconds. */
export function frameTimes(intervalsMs: readonly number[]): number[] {
  const times = [0];
  for (const dt of intervalsMs) times.push(times[times.length - 1]! + dt);
  return times;
}

/**
 * Steady-state gain of the per-axis constant-velocity Kalman filter
 * (state: position, velocity; measurement: position), found by iterating the
 * Riccati recursion. An independent two-state reference for poseKalman.
 */
export function steadyStateGain(dt: number, accelerationDensity: number, measurementVariance: number): [number, number] {
  const q = accelerationDensity;
  let p = [measurementVariance, 0, 0, 1e6];
  let gain: [number, number] = [0, 0];
  for (let i = 0; i < 100000; i++) {
    const [p00, p01, , p11] = p as [number, number, number, number];
    const m00 = p00 + 2 * dt * p01 + dt * dt * p11 + (q * dt ** 3) / 3;
    const m01 = p01 + dt * p11 + (q * dt ** 2) / 2;
    const m11 = p11 + q * dt;
    const s = m00 + measurementVariance;
    const next: [number, number] = [m00 / s, m01 / s];
    p = [(1 - next[0]) * m00, (1 - next[0]) * m01, (1 - next[0]) * m01, m11 - next[1] * m01];
    if (Math.abs(next[0] - gain[0]) < 1e-15 && Math.abs(next[1] - gain[1]) < 1e-15) return next;
    gain = next;
  }
  return gain;
}

/**
 * Standard deviation of the steady-state filter's position output, per unit
 * of white measurement noise, when the true position is constant: the root of
 * the stationary solution of S = A S A^T + K K^T with A = (I - K H) F.
 */
export function stationaryNoiseGain(dt: number, gain: [number, number]): number {
  const [k0, k1] = gain;
  // A = (I - K H) F with F = [[1, dt], [0, 1]], H = [1, 0].
  const a = [1 - k0, (1 - k0) * dt, -k1, 1 - k1 * dt];
  let s = [0, 0, 0, 0];
  for (let i = 0; i < 100000; i++) {
    const [a00, a01, a10, a11] = a as [number, number, number, number];
    const [s00, s01, s10, s11] = s as [number, number, number, number];
    const t00 = a00 * s00 + a01 * s10;
    const t01 = a00 * s01 + a01 * s11;
    const t10 = a10 * s00 + a11 * s10;
    const t11 = a10 * s01 + a11 * s11;
    const next = [
      t00 * a00 + t01 * a01 + k0 * k0,
      t00 * a10 + t01 * a11 + k0 * k1,
      t10 * a00 + t11 * a01 + k1 * k0,
      t10 * a10 + t11 * a11 + k1 * k1,
    ];
    if (Math.abs(next[0]! - s[0]!) < 1e-16) return Math.sqrt(next[0]!);
    s = next;
  }
  return Math.sqrt(s[0]!);
}

/** Position output of the steady-state two-state filter for a measurement sequence. */
export function steadyStateResponse(dt: number, gain: [number, number], measurements: readonly number[], start: number): number[] {
  let x = start;
  let v = 0;
  return measurements.map((z) => {
    const predicted = x + v * dt;
    const innovation = z - predicted;
    x = predicted + gain[0] * innovation;
    v += gain[1] * innovation;
    return x;
  });
}

/** Index of the first sample at or past `fraction` of the way from `from` to `to`. */
export function firstReaching(values: readonly number[], from: number, to: number, fraction: number): number {
  const threshold = from + fraction * (to - from);
  return values.findIndex((v) => (to > from ? v >= threshold : v <= threshold));
}
