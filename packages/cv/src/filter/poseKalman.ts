import { mat3Multiply, type Mat3, type Vec3 } from '../linalg.ts';
import type { HeadPose } from '../pnp.ts';
import {
  matrixFromQuaternion,
  quaternionConjugate,
  quaternionFromMatrix,
  quaternionFromRotationVector,
  quaternionMultiply,
  rotationMatrixFromVector,
  rotationVectorFromQuaternion,
  type Quaternion,
} from '../rotation.ts';
import {
  assertFinitePose,
  continuesSequence,
  horizonSeconds,
  resolveTiming,
  type PoseFilter,
  type PoseFilterTiming,
} from './poseFilter.ts';

export interface PoseKalmanOptions extends PoseFilterTiming {
  /**
   * Square root of the spectral density of the white angular acceleration the
   * constant-velocity model allows, in rad/s^2 per sqrt(Hz). Larger follows
   * faster turns and smooths less.
   */
  readonly angularAccelerationNoise: number;
  /** The same for linear acceleration, mm/s^2 per sqrt(Hz), on each camera axis. */
  readonly linearAccelerationNoiseMm: number;
  /** Standard deviation of the measured rotation about each axis, radians. */
  readonly rotationNoiseRad: number;
  /** Standard deviation of the measured translation along camera x, y and z, mm. */
  readonly translationNoiseMm: Vec3;
  /** Prior standard deviation of the angular velocity on a restart, rad/s. */
  readonly initialAngularSpeedRad?: number;
  /** Prior standard deviation of each velocity axis on a restart, mm/s. */
  readonly initialSpeedMm?: number;
}

/** About a quick head turn, so the second measurement sets the velocity. */
const DEFAULT_INITIAL_ANGULAR_SPEED_RAD = 2;
const DEFAULT_INITIAL_SPEED_MM = 300;

/** 6 x 6 row-major covariance of one block: three pose errors, then three velocity errors. */
type Covariance = Float64Array;

const N = 6;

function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < N; k++) {
      const aik = a[i * N + k];
      if (aik === 0) continue;
      for (let j = 0; j < N; j++) out[i * N + j] += aik * b[k * N + j];
    }
  }
  return out;
}

function transpose(a: Float64Array): Float64Array {
  const out = new Float64Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) out[j * N + i] = a[i * N + j];
  return out;
}

/** a m a^T, symmetrized so rounding never makes the covariance asymmetric. */
function congruence(a: Float64Array, m: Float64Array): Float64Array {
  const out = multiply(multiply(a, m), transpose(a));
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const mean = 0.5 * (out[i * N + j] + out[j * N + i]);
      out[i * N + j] = mean;
      out[j * N + i] = mean;
    }
  }
  return out;
}

function diagonal(values: readonly number[]): Float64Array {
  const out = new Float64Array(N * N);
  values.forEach((v, i) => (out[i * N + i] = v));
  return out;
}

/** Places 3 x 3 row-major blocks into a 6 x 6 matrix: [[a, b], [c, d]]. */
function blocks(a: Mat3, b: Mat3, c: Mat3, d: Mat3): Float64Array {
  const out = new Float64Array(N * N);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * N + j] = a[i * 3 + j];
      out[i * N + j + 3] = b[i * 3 + j];
      out[(i + 3) * N + j] = c[i * 3 + j];
      out[(i + 3) * N + j + 3] = d[i * 3 + j];
    }
  }
  return out;
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const mat3Of = (entry: (i: number) => number): Mat3 => [
  entry(0),
  entry(1),
  entry(2),
  entry(3),
  entry(4),
  entry(5),
  entry(6),
  entry(7),
  entry(8),
];
const scaled = (m: Mat3, s: number): Mat3 => mat3Of((i) => m[i] * s);

const skew = (v: Vec3): Mat3 => [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];

/**
 * Left Jacobian of SO(3): exp(phi + d) = exp(J(phi) d) exp(phi) to first
 * order in d.
 */
export function leftJacobian(phi: Vec3): Mat3 {
  const theta = Math.hypot(phi[0], phi[1], phi[2]);
  const k = skew(phi);
  const k2 = mat3Multiply(k, k);
  // Taylor coefficients below 1e-4 rad keep full precision where the closed form cancels.
  const a = theta < 1e-4 ? 0.5 - (theta * theta) / 24 : (1 - Math.cos(theta)) / (theta * theta);
  const b = theta < 1e-4 ? 1 / 6 - (theta * theta) / 120 : (theta - Math.sin(theta)) / (theta * theta * theta);
  return mat3Of((i) => IDENTITY[i] + a * k[i] + b * k2[i]);
}

/**
 * Error transition of the rotation block over dt seconds at angular velocity
 * w: d <- R(w dt) d + J(w dt) dt dw, dw <- dw. Row-major 6 x 6.
 */
export function rotationErrorTransition(angularVelocity: Vec3, dt: number): Float64Array {
  const turn: Vec3 = [angularVelocity[0] * dt, angularVelocity[1] * dt, angularVelocity[2] * dt];
  return blocks(rotationMatrixFromVector(turn), scaled(leftJacobian(turn), dt), ZERO, IDENTITY);
}

/**
 * Discretized white-noise acceleration over dt for one block:
 * q [[dt^3/3, dt^2/2], [dt^2/2, dt]] on each axis.
 */
function processNoise(spectralDensity: number, dt: number): Float64Array {
  const q = spectralDensity;
  return blocks(
    scaled(IDENTITY, (q * dt ** 3) / 3),
    scaled(IDENTITY, (q * dt ** 2) / 2),
    scaled(IDENTITY, (q * dt ** 2) / 2),
    scaled(IDENTITY, q * dt),
  );
}

function inverse3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 0) || !Number.isFinite(det)) return null;
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
}

/**
 * Kalman update of one block with the measurement H = [I 0] and diagonal
 * noise variances. Returns the error-state correction and the posterior
 * covariance in Joseph form, which stays positive semidefinite under rounding.
 */
function measurementUpdate(
  p: Covariance,
  innovation: Vec3,
  variances: Vec3,
): { correction: Float64Array; covariance: Covariance } | null {
  const s = mat3Of((k) => {
    const i = Math.floor(k / 3);
    const j = k % 3;
    return p[i * N + j] + (i === j ? variances[i] : 0);
  });
  const sInverse = inverse3(s);
  if (!sInverse) return null;
  // K = P H^T S^-1: the first three columns of P times S^-1.
  const gain = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += p[i * N + k] * sInverse[k * 3 + j];
      gain[i * 3 + j] = sum;
    }
  }
  const correction = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    correction[i] = gain[i * 3] * innovation[0] + gain[i * 3 + 1] * innovation[1] + gain[i * 3 + 2] * innovation[2];
  }
  const a = diagonal([1, 1, 1, 1, 1, 1]);
  for (let i = 0; i < N; i++) for (let j = 0; j < 3; j++) a[i * N + j] -= gain[i * 3 + j];
  const krk = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += gain[i * 3 + k] * variances[k] * gain[j * 3 + k];
      krk[i * N + j] = sum;
    }
  }
  const covariance = congruence(a, p);
  for (let i = 0; i < N * N; i++) covariance[i] += krk[i];
  return { correction, covariance };
}

interface State {
  timestampMs: number;
  rotation: Quaternion;
  /** Camera-frame angular velocity, rad/s. */
  angularVelocity: Vec3;
  translation: Vec3;
  /** mm/s. */
  velocity: Vec3;
  /** Over (rotation error, angular velocity error). */
  rotationCovariance: Covariance;
  /** Over (translation error, velocity error). */
  translationCovariance: Covariance;
}

const square = (v: number): number => v * v;

/**
 * Error-state Kalman filter on SE(3) with a constant-velocity model.
 *
 * Nominal state: rotation q, camera-frame angular velocity w, translation p
 * and velocity v. Error state: 12 values, with the rotation error d on the
 * tangent space as a left perturbation, true q = exp(d) q. Over dt the nominal
 * state moves as q <- exp(w dt) q, p <- p + v dt, and the error as
 * d <- R(w dt) d + J(w dt) dt dw, where R is the rotation of w dt and J the
 * left Jacobian. Rotation and translation never mix in this model, so the
 * covariance is kept as two 6 x 6 blocks. A measured pose (qm, pm) gives the
 * innovation (log(qm q^-1), pm - p); the correction is folded into the
 * nominal state and the rotation covariance is mapped through J(d) to the
 * new nominal rotation.
 */
export function poseKalman(options: PoseKalmanOptions): PoseFilter {
  const {
    angularAccelerationNoise,
    linearAccelerationNoiseMm,
    rotationNoiseRad,
    translationNoiseMm,
    initialAngularSpeedRad = DEFAULT_INITIAL_ANGULAR_SPEED_RAD,
    initialSpeedMm = DEFAULT_INITIAL_SPEED_MM,
  } = options;
  const positive = [
    angularAccelerationNoise,
    linearAccelerationNoiseMm,
    rotationNoiseRad,
    ...translationNoiseMm,
    initialAngularSpeedRad,
    initialSpeedMm,
  ];
  if (!positive.every((v) => v > 0 && Number.isFinite(v))) {
    throw new RangeError('poseKalman noise levels must be positive and finite');
  }
  const timing = resolveTiming(options);
  const rotationVariances: Vec3 = [square(rotationNoiseRad), square(rotationNoiseRad), square(rotationNoiseRad)];
  const translationVariances: Vec3 = [
    square(translationNoiseMm[0]),
    square(translationNoiseMm[1]),
    square(translationNoiseMm[2]),
  ];
  let state: State | null = null;

  const restart = (rotation: Quaternion, translation: Vec3, timestampMs: number): State => ({
    timestampMs,
    rotation,
    angularVelocity: [0, 0, 0],
    translation,
    velocity: [0, 0, 0],
    rotationCovariance: diagonal([...rotationVariances, ...Array(3).fill(square(initialAngularSpeedRad))]),
    translationCovariance: diagonal([...translationVariances, ...Array(3).fill(square(initialSpeedMm))]),
  });

  const propagate = (s: State, dt: number): State => {
    const turn: Vec3 = [s.angularVelocity[0] * dt, s.angularVelocity[1] * dt, s.angularVelocity[2] * dt];
    const rotationTransition = rotationErrorTransition(s.angularVelocity, dt);
    const translationTransition = blocks(IDENTITY, scaled(IDENTITY, dt), ZERO, IDENTITY);
    const rotationCovariance = congruence(rotationTransition, s.rotationCovariance);
    const rotationNoise = processNoise(square(angularAccelerationNoise), dt);
    const translationCovariance = congruence(translationTransition, s.translationCovariance);
    const translationNoise = processNoise(square(linearAccelerationNoiseMm), dt);
    for (let i = 0; i < N * N; i++) {
      rotationCovariance[i] += rotationNoise[i];
      translationCovariance[i] += translationNoise[i];
    }
    return {
      ...s,
      rotation: quaternionMultiply(quaternionFromRotationVector(turn), s.rotation),
      translation: [
        s.translation[0] + s.velocity[0] * dt,
        s.translation[1] + s.velocity[1] * dt,
        s.translation[2] + s.velocity[2] * dt,
      ],
      rotationCovariance,
      translationCovariance,
    };
  };

  const poseOf = (s: State): HeadPose => ({ rotation: matrixFromQuaternion(s.rotation), translationMm: s.translation });

  return {
    update(pose, timestampMs) {
      assertFinitePose(pose, timestampMs);
      const measured = quaternionFromMatrix(pose.rotation);
      if (!state || !continuesSequence(state.timestampMs, timestampMs, timing.maxGapMs)) {
        state = restart(measured, pose.translationMm, timestampMs);
        return poseOf(state);
      }
      const prior = propagate(state, (timestampMs - state.timestampMs) / 1000);
      const rotationInnovation = rotationVectorFromQuaternion(
        quaternionMultiply(measured, quaternionConjugate(prior.rotation)),
      );
      const translationInnovation: Vec3 = [
        pose.translationMm[0] - prior.translation[0],
        pose.translationMm[1] - prior.translation[1],
        pose.translationMm[2] - prior.translation[2],
      ];
      const rotationUpdate = measurementUpdate(prior.rotationCovariance, rotationInnovation, rotationVariances);
      const translationUpdate = measurementUpdate(prior.translationCovariance, translationInnovation, translationVariances);
      if (!rotationUpdate || !translationUpdate) {
        state = restart(measured, pose.translationMm, timestampMs);
        return poseOf(state);
      }
      const dr = rotationUpdate.correction;
      const dt = translationUpdate.correction;
      const rotationError: Vec3 = [dr[0], dr[1], dr[2]];
      const reset = blocks(leftJacobian(rotationError), ZERO, ZERO, IDENTITY);
      state = {
        timestampMs,
        rotation: quaternionMultiply(quaternionFromRotationVector(rotationError), prior.rotation),
        angularVelocity: [
          prior.angularVelocity[0] + dr[3],
          prior.angularVelocity[1] + dr[4],
          prior.angularVelocity[2] + dr[5],
        ],
        translation: [prior.translation[0] + dt[0], prior.translation[1] + dt[1], prior.translation[2] + dt[2]],
        velocity: [prior.velocity[0] + dt[3], prior.velocity[1] + dt[4], prior.velocity[2] + dt[5]],
        rotationCovariance: congruence(reset, rotationUpdate.covariance),
        translationCovariance: translationUpdate.covariance,
      };
      return poseOf(state);
    },

    predict(timestampMs) {
      if (!state) return null;
      const h = horizonSeconds(state.timestampMs, timestampMs, timing);
      if (h === null) return null;
      const w = state.angularVelocity;
      const v = state.velocity;
      return {
        rotation: matrixFromQuaternion(
          quaternionMultiply(quaternionFromRotationVector([w[0] * h, w[1] * h, w[2] * h]), state.rotation),
        ),
        translationMm: [state.translation[0] + v[0] * h, state.translation[1] + v[1] * h, state.translation[2] + v[2] * h],
      };
    },

    reset() {
      state = null;
    },
  };
}
