import { vec3Sub, type Vec3 } from '../linalg.ts';
import type { HeadPose } from '../pnp.ts';
import {
  matrixFromQuaternion,
  quaternionConjugate,
  quaternionFromMatrix,
  quaternionFromRotationVector,
  quaternionMultiply,
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

/**
 * One Euro parameters for one channel. The cutoff is
 * minCutoffHz + beta * speed, with speed in rad/s for rotation and mm/s per
 * axis for translation, so beta is in Hz per unit of speed.
 */
export interface OneEuroChannel {
  readonly minCutoffHz: number;
  readonly beta: number;
  /** Cutoff of the low-pass on the speed estimate that drives the cutoff. */
  readonly derivativeCutoffHz: number;
}

export interface OneEuroPoseOptions extends PoseFilterTiming {
  readonly rotation: OneEuroChannel;
  readonly translation: OneEuroChannel;
}

/**
 * Smoothing factor of a first-order low-pass with cutoff fc sampled after dt
 * seconds: dt / (dt + tau) with tau = 1 / (2 pi fc). Exact for any dt, which
 * is what makes the filter correct under variable frame intervals.
 */
export function oneEuroAlpha(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return dtSeconds / (dtSeconds + tau);
}

function checkChannel(name: string, channel: OneEuroChannel): void {
  if (!(channel.minCutoffHz > 0) || !(channel.beta >= 0) || !(channel.derivativeCutoffHz > 0)) {
    throw new RangeError(`${name}: cutoffs must be positive and beta non-negative`);
  }
}

interface State {
  timestampMs: number;
  rawRotation: Quaternion;
  rotation: Quaternion;
  /** Filtered angular velocity in the camera frame, rad/s. */
  angularVelocity: Vec3;
  rawTranslation: Vec3;
  translation: Vec3;
  /** Filtered linear velocity per axis, mm/s. */
  velocity: Vec3;
}

/**
 * Rotation vector of a * b^-1: the rotation that takes b to a, in the camera
 * frame. The log map returns the shorter of the two arcs whatever the signs of
 * a and b, so the filter never sees the sign flip quaternionFromMatrix makes
 * where the rotation angle passes pi.
 */
const leftDifference = (a: Quaternion, b: Quaternion): Vec3 =>
  rotationVectorFromQuaternion(quaternionMultiply(a, quaternionConjugate(b)));

const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

/** First-order low-pass step from `from` toward `to`. */
const towards = (from: Vec3, to: Vec3, alpha: number): Vec3 => [
  from[0] + alpha * (to[0] - from[0]),
  from[1] + alpha * (to[1] - from[1]),
  from[2] + alpha * (to[2] - from[2]),
];

const poseOf = (rotation: Quaternion, translationMm: Vec3): HeadPose => ({
  rotation: matrixFromQuaternion(rotation),
  translationMm,
});

/**
 * One Euro filter (Casiez et al., CHI 2012) on SE(3). Rotation is filtered on
 * the tangent space: the angular velocity is the log of the change between
 * raw rotations over dt, and the filtered rotation moves toward the new one
 * by the smoothing factor along the geodesic (a slerp). Each translation axis
 * is its own One Euro filter. `predict` extrapolates with the filtered
 * velocities.
 */
export function oneEuroPose(options: OneEuroPoseOptions): PoseFilter {
  checkChannel('rotation', options.rotation);
  checkChannel('translation', options.translation);
  const timing = resolveTiming(options);
  const { rotation: rot, translation: trans } = options;
  let state: State | null = null;

  return {
    update(pose, timestampMs) {
      assertFinitePose(pose, timestampMs);
      const measured = quaternionFromMatrix(pose.rotation);
      if (!state || !continuesSequence(state.timestampMs, timestampMs, timing.maxGapMs)) {
        state = {
          timestampMs,
          rawRotation: measured,
          rotation: measured,
          angularVelocity: [0, 0, 0],
          rawTranslation: pose.translationMm,
          translation: pose.translationMm,
          velocity: [0, 0, 0],
        };
        return poseOf(measured, pose.translationMm);
      }
      const dt = (timestampMs - state.timestampMs) / 1000;

      const rawAngular = scale(leftDifference(measured, state.rawRotation), 1 / dt);
      const alphaAngular = oneEuroAlpha(rot.derivativeCutoffHz, dt);
      const angularVelocity = towards(state.angularVelocity, rawAngular, alphaAngular);
      const speed = Math.hypot(...angularVelocity);
      const alphaRotation = oneEuroAlpha(rot.minCutoffHz + rot.beta * speed, dt);
      const step = scale(leftDifference(measured, state.rotation), alphaRotation);
      const rotation = quaternionMultiply(quaternionFromRotationVector(step), state.rotation);

      const rawVelocity = scale(vec3Sub(pose.translationMm, state.rawTranslation), 1 / dt);
      const velocity = towards(state.velocity, rawVelocity, oneEuroAlpha(trans.derivativeCutoffHz, dt));
      const axisAlpha = (i: 0 | 1 | 2) => oneEuroAlpha(trans.minCutoffHz + trans.beta * Math.abs(velocity[i]), dt);
      const translation: Vec3 = [
        state.translation[0] + axisAlpha(0) * (pose.translationMm[0] - state.translation[0]),
        state.translation[1] + axisAlpha(1) * (pose.translationMm[1] - state.translation[1]),
        state.translation[2] + axisAlpha(2) * (pose.translationMm[2] - state.translation[2]),
      ];

      state = {
        timestampMs,
        rawRotation: measured,
        rotation,
        angularVelocity,
        rawTranslation: pose.translationMm,
        translation,
        velocity,
      };
      return poseOf(rotation, translation);
    },

    predict(timestampMs) {
      if (!state) return null;
      const h = horizonSeconds(state.timestampMs, timestampMs, timing);
      if (h === null) return null;
      const rotation = quaternionMultiply(quaternionFromRotationVector(scale(state.angularVelocity, h)), state.rotation);
      return poseOf(rotation, [
        state.translation[0] + state.velocity[0] * h,
        state.translation[1] + state.velocity[1] * h,
        state.translation[2] + state.velocity[2] * h,
      ]);
    },

    reset() {
      state = null;
    },
  };
}
