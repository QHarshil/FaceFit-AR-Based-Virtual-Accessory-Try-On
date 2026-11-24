import { describe, expect, it } from 'vitest';
import { estimateIntrinsics } from '../src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import { DEFAULT_MAX_GAP_MS } from '../src/filter/poseFilter.ts';
import { leftJacobian, poseKalman, rotationErrorTransition, type PoseKalmanOptions } from '../src/filter/poseKalman.ts';
import { mat3MulVec3, type Vec3 } from '../src/linalg.ts';
import type { HeadPose } from '../src/pnp.ts';
import { solveHeadPose } from '../src/pnp.ts';
import {
  angleBetweenRotations,
  quaternionFromRotationVector,
  quaternionMultiply,
  rotationMatrixFromVector,
  rotationVectorFromQuaternion,
} from '../src/rotation.ts';
import { seededRandom } from './random.ts';
import {
  constantVelocityPose,
  DEG,
  firstReaching,
  frameTimes,
  noisyPose,
  REST_POSE,
  rotationError,
  standardDeviation,
  stationaryNoiseGain,
  steadyStateGain,
  steadyStateResponse,
} from './poseTruth.ts';
import { projectWithNoise } from './syntheticPose.ts';

const DT_MS = 1000 / 30;
const DT = DT_MS / 1000;

// Noise levels near the solver's on a still face; the process noise is low
// enough that the filter halves rotation noise at rest.
const OPTIONS: PoseKalmanOptions = {
  angularAccelerationNoise: 0.05,
  linearAccelerationNoiseMm: 5,
  rotationNoiseRad: 0.3 * DEG,
  translationNoiseMm: [0.5, 0.5, 4],
};

describe('poseKalman on a stationary pose with noise', () => {
  // At rest the model is three independent constant-velocity filters per
  // block, so each axis has the steady-state gain of the two-state filter and
  // passes white noise with the stationary gain computed from it
  // (stationaryNoiseGain). 6000 samples of output correlated over about ten
  // frames leave about 600 independent ones: 3% at one sigma, bound 10%.
  it('passes the noise std times the steady-state two-state filter gain', () => {
    const random = seededRandom(201);
    const filter = poseKalman(OPTIONS);
    const raw: HeadPose[] = [];
    const filtered: HeadPose[] = [];
    for (let k = 0; k < 6300; k++) {
      const measured = noisyPose(REST_POSE, random, OPTIONS.rotationNoiseRad, OPTIONS.translationNoiseMm);
      const output = filter.update(measured, k * DT_MS);
      if (k < 300) continue;
      raw.push(measured);
      filtered.push(output);
    }
    const rotationGain = stationaryNoiseGain(
      DT,
      steadyStateGain(DT, OPTIONS.angularAccelerationNoise ** 2, OPTIONS.rotationNoiseRad ** 2),
    );
    for (let axis = 0; axis < 3; axis++) {
      const translationGain = stationaryNoiseGain(
        DT,
        steadyStateGain(DT, OPTIONS.linearAccelerationNoiseMm ** 2, OPTIONS.translationNoiseMm[axis]! ** 2),
      );
      const translationRatio =
        standardDeviation(filtered.map((p) => p.translationMm[axis]!)) /
        standardDeviation(raw.map((p) => p.translationMm[axis]!));
      const rotationRatio =
        standardDeviation(filtered.map((p) => rotationError(p.rotation, REST_POSE.rotation)[axis]!)) /
        standardDeviation(raw.map((p) => rotationError(p.rotation, REST_POSE.rotation)[axis]!));
      expect(Math.abs(translationRatio / translationGain - 1)).toBeLessThan(0.1);
      expect(Math.abs(rotationRatio / rotationGain - 1)).toBeLessThan(0.1);
      expect(rotationGain).toBeLessThan(0.5);
    }
  });

  // Landmarks projected through known intrinsics with 0.5 px noise, solved,
  // then filtered. The gain depends only on the filter's own Q and R, not on
  // the actual noise level, so the stationary gain holds for the solver's
  // noise too; 2000 samples, bound 15%.
  it('reduces solveHeadPose rotation noise from noisy landmarks by the same gain', () => {
    const random = seededRandom(202);
    const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 })!;
    const filter = poseKalman(OPTIONS);
    const rawAngles: number[][] = [[], [], []];
    const filteredAngles: number[][] = [[], [], []];
    for (let k = 0; k < 2300; k++) {
      const pixels = projectWithNoise(REST_POSE, RIGID_FACE_LANDMARKS, intrinsics, 0.5, random);
      const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
      if (!solved.ok) throw new Error(solved.reason);
      const filtered = filter.update(solved, k * DT_MS);
      if (k < 300) continue;
      const rawError = rotationError(solved.rotation, REST_POSE.rotation);
      const filteredError = rotationError(filtered.rotation, REST_POSE.rotation);
      for (let axis = 0; axis < 3; axis++) {
        rawAngles[axis]!.push(rawError[axis]!);
        filteredAngles[axis]!.push(filteredError[axis]!);
      }
    }
    const expected = stationaryNoiseGain(
      DT,
      steadyStateGain(DT, OPTIONS.angularAccelerationNoise ** 2, OPTIONS.rotationNoiseRad ** 2),
    );
    for (let axis = 0; axis < 3; axis++) {
      const ratio = standardDeviation(filteredAngles[axis]!) / standardDeviation(rawAngles[axis]!);
      expect(Math.abs(ratio / expected - 1)).toBeLessThan(0.15);
    }
  });
});

describe('poseKalman at constant velocity', () => {
  const angularVelocity: Vec3 = [0.4, -0.7, 0.25];
  const velocity: Vec3 = [150, -80, 60];

  // The constant-velocity model matches this motion, so once the covariance
  // has settled the posterior and its extrapolation converge to the truth:
  // zero steady-state error, here below 1e-6 mm and 1e-8 rad.
  const errorsAfterConvergence = (intervalsMs: readonly number[]) => {
    const filter = poseKalman(OPTIONS);
    const errors: { filtered: number[]; predicted: number[] }[] = [];
    frameTimes(intervalsMs).forEach((t, k) => {
      const truth = constantVelocityPose(REST_POSE, angularVelocity, velocity, t / 1000);
      const filtered = filter.update(truth, t);
      if (k < 400) return;
      const ahead = constantVelocityPose(REST_POSE, angularVelocity, velocity, (t + 33) / 1000);
      const predicted = filter.predict(t + 33)!;
      errors.push({
        filtered: [
          angleBetweenRotations(filtered.rotation, truth.rotation),
          ...[0, 1, 2].map((i) => Math.abs(filtered.translationMm[i]! - truth.translationMm[i]!)),
        ],
        predicted: [
          angleBetweenRotations(predicted.rotation, ahead.rotation),
          ...[0, 1, 2].map((i) => Math.abs(predicted.translationMm[i]! - ahead.translationMm[i]!)),
        ],
      });
    });
    return errors;
  };

  const expectConverged = (errors: { filtered: number[]; predicted: number[] }[]) => {
    for (const { filtered, predicted } of errors) {
      expect(filtered[0]).toBeLessThan(1e-8);
      expect(predicted[0]).toBeLessThan(1e-8);
      for (const mm of [...filtered.slice(1), ...predicted.slice(1)]) expect(mm).toBeLessThan(1e-6);
    }
  };

  it('has zero steady-state error in the posterior and the prediction', () => {
    expectConverged(errorsAfterConvergence(Array(600).fill(DT_MS)));
  });

  it('keeps zero steady-state error when the frame interval varies between 15 and 60 ms', () => {
    const random = seededRandom(203);
    expectConverged(errorsAfterConvergence(Array.from({ length: 600 }, () => random.uniform(15, 60))));
  });
});

describe('poseKalman on a step', () => {
  // After 300 frames at rest the gain has settled, so the response to a step
  // on one axis is that of the steady-state two-state filter
  // (steadyStateResponse). Rotation about one fixed axis stays on that axis,
  // where R(w dt) and J(w dt) act as the identity.
  const settle = 300;
  const stepMm = 50;
  const stepRad = 10 * DEG;

  const responses = () => {
    const filter = poseKalman(OPTIONS);
    const xs: number[] = [];
    const angles: number[] = [];
    for (let k = 0; k < settle + 60; k++) {
      const stepped = k >= settle;
      const pose: HeadPose = {
        rotation: rotationMatrixFromVector([0, 0, stepped ? stepRad : 0]),
        translationMm: [stepped ? stepMm : 0, 0, 600],
      };
      const output = filter.update(pose, k * DT_MS);
      if (k < settle) continue;
      xs.push(output.translationMm[0]);
      angles.push(Math.atan2(output.rotation[3], output.rotation[0]));
    }
    return { xs, angles };
  };

  it('follows the steady-state two-state filter response on translation and rotation', () => {
    const { xs, angles } = responses();
    const translationGain = steadyStateGain(DT, OPTIONS.linearAccelerationNoiseMm ** 2, OPTIONS.translationNoiseMm[0] ** 2);
    const rotationGain = steadyStateGain(DT, OPTIONS.angularAccelerationNoise ** 2, OPTIONS.rotationNoiseRad ** 2);
    const expectedXs = steadyStateResponse(DT, translationGain, Array(60).fill(stepMm), 0);
    const expectedAngles = steadyStateResponse(DT, rotationGain, Array(60).fill(stepRad), 0);
    xs.forEach((x, i) => expect(Math.abs(x - expectedXs[i]!)).toBeLessThan(1e-6 * stepMm));
    angles.forEach((a, i) => expect(Math.abs(a - expectedAngles[i]!)).toBeLessThan(1e-6 * stepRad));
    expect(firstReaching(xs, 0, stepMm, 0.9)).toBe(firstReaching(expectedXs, 0, stepMm, 0.9));
    expect(firstReaching(angles, 0, stepRad, 0.9)).toBe(firstReaching(expectedAngles, 0, stepRad, 0.9));
  });

  // A constant-velocity filter overshoots a step: the velocity it picks up
  // while catching up carries it past. It must settle within 1% in a second.
  it('overshoots and settles within 1% of the step in 30 frames', () => {
    const { xs } = responses();
    expect(Math.max(...xs)).toBeGreaterThan(stepMm);
    for (const x of xs.slice(30)) expect(Math.abs(x - stepMm)).toBeLessThan(0.01 * stepMm);
  });
});

describe('poseKalman rotation through 180 degrees', () => {
  it('tracks a turn through pi with zero error and no jump', () => {
    const filter = poseKalman(OPTIONS);
    const speed = 1.5;
    // The angle passes pi at frame 90, after the error has settled.
    const start: HeadPose = { rotation: rotationMatrixFromVector([0, 0, Math.PI - 3 * speed]), translationMm: [0, 0, 600] };
    for (let k = 0; k < 150; k++) {
      const t = k * DT_MS;
      const truth = constantVelocityPose(start, [0, 0, speed], [0, 0, 0], t / 1000);
      const filtered = filter.update(truth, t);
      if (k > 60) expect(angleBetweenRotations(filtered.rotation, truth.rotation)).toBeLessThan(1e-8);
    }
  });
});

describe('leftJacobian', () => {
  it('maps a tangent perturbation to the left increment: exp(phi + d) = exp(J d) exp(phi)', () => {
    const random = seededRandom(204);
    for (let trial = 0; trial < 200; trial++) {
      const phi: Vec3 = [random.uniform(-2, 2), random.uniform(-2, 2), random.uniform(-2, 2)];
      const d: Vec3 = [random.gaussian(1e-6), random.gaussian(1e-6), random.gaussian(1e-6)];
      const exact = quaternionFromRotationVector([phi[0] + d[0], phi[1] + d[1], phi[2] + d[2]]);
      const approximate = quaternionMultiply(
        quaternionFromRotationVector(mat3MulVec3(leftJacobian(phi), d)),
        quaternionFromRotationVector(phi),
      );
      const difference = rotationVectorFromQuaternion(
        quaternionMultiply(exact, { w: approximate.w, x: -approximate.x, y: -approximate.y, z: -approximate.z }),
      );
      // Second order in |d| = 1e-6.
      expect(Math.hypot(...difference)).toBeLessThan(1e-11);
    }
    const tiny = leftJacobian([1e-9, 0, 0]);
    expect(tiny[5]).toBeCloseTo(-5e-10, 15);
  });
});

describe('rotationErrorTransition', () => {
  // Finite-difference check of the error dynamics: perturb the true state by
  // (d, dw) around the nominal one, propagate both exactly, and compare the
  // new rotation error log(q_true' q') with the first three rows of F.
  it('matches the exact propagation of a perturbed state to second order', () => {
    const random = seededRandom(205);
    for (let trial = 0; trial < 200; trial++) {
      const w: Vec3 = [random.uniform(-4, 4), random.uniform(-4, 4), random.uniform(-4, 4)];
      const dt = random.uniform(0.01, 0.1);
      const d: Vec3 = [random.gaussian(1e-6), random.gaussian(1e-6), random.gaussian(1e-6)];
      const dw: Vec3 = [random.gaussian(1e-5), random.gaussian(1e-5), random.gaussian(1e-5)];
      const nominal = quaternionFromRotationVector([random.uniform(-2, 2), random.uniform(-2, 2), random.uniform(-2, 2)]);
      const trueRotation = quaternionMultiply(quaternionFromRotationVector(d), nominal);
      const nextTrue = quaternionMultiply(
        quaternionFromRotationVector([(w[0] + dw[0]) * dt, (w[1] + dw[1]) * dt, (w[2] + dw[2]) * dt]),
        trueRotation,
      );
      const nextNominal = quaternionMultiply(quaternionFromRotationVector([w[0] * dt, w[1] * dt, w[2] * dt]), nominal);
      const exact = rotationVectorFromQuaternion(
        quaternionMultiply(nextTrue, { w: nextNominal.w, x: -nextNominal.x, y: -nextNominal.y, z: -nextNominal.z }),
      );
      const f = rotationErrorTransition(w, dt);
      const error = [...d, ...dw];
      for (let i = 0; i < 3; i++) {
        let linear = 0;
        for (let j = 0; j < 6; j++) linear += f[i * 6 + j]! * error[j]!;
        expect(Math.abs(linear - exact[i]!)).toBeLessThan(1e-11);
      }
    }
  });
});

describe('poseKalman state handling', () => {
  const at = (x: number): HeadPose => ({ rotation: REST_POSE.rotation, translationMm: [x, 0, 600] });

  it('restarts from the raw pose after a gap, a reset or a repeated timestamp', () => {
    const filter = poseKalman(OPTIONS);
    expect(filter.predict(0)).toBeNull();
    filter.update(at(0), 0);
    filter.update(at(10), DT_MS);
    expect(filter.update(at(40), DT_MS + DEFAULT_MAX_GAP_MS + 1).translationMm[0]).toBe(40);
    expect(filter.update(at(60), DT_MS + DEFAULT_MAX_GAP_MS + 1).translationMm[0]).toBe(60);
    filter.reset();
    expect(filter.predict(1000)).toBeNull();
    expect(filter.update(at(80), 1000).translationMm[0]).toBe(80);
  });

  it('clamps the prediction horizon to [last update, last update + maxPredictionMs]', () => {
    const filter = poseKalman({ ...OPTIONS, maxPredictionMs: 50 });
    for (let k = 0; k < 100; k++) filter.update(at(k * 3), k * DT_MS);
    const last = 99 * DT_MS;
    const posterior = filter.predict(last)!.translationMm[0];
    expect(filter.predict(last - 20)!.translationMm[0]).toBe(posterior);
    expect(filter.predict(last + 150)!.translationMm[0]).toBeCloseTo(filter.predict(last + 50)!.translationMm[0], 12);
    expect(filter.predict(last + 50)!.translationMm[0]).toBeCloseTo(posterior + 90 * 0.05, 6);
  });

  it('stops predicting past maxGapMs after the last update', () => {
    const filter = poseKalman(OPTIONS);
    for (let k = 0; k < 30; k++) filter.update(at(k * 3), k * DT_MS);
    const last = 29 * DT_MS;
    expect(filter.predict(last + DEFAULT_MAX_GAP_MS)).not.toBeNull();
    expect(filter.predict(last + DEFAULT_MAX_GAP_MS + 1)).toBeNull();
    expect(filter.predict(last + 300_000)).toBeNull();
    expect(filter.predict(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('rejects non-finite input and invalid parameters', () => {
    const filter = poseKalman(OPTIONS);
    expect(() => filter.update(at(Number.NaN), 0)).toThrow(RangeError);
    expect(() => filter.update(at(0), Number.NaN)).toThrow(RangeError);
    expect(() => poseKalman({ ...OPTIONS, rotationNoiseRad: 0 })).toThrow(RangeError);
    expect(() => poseKalman({ ...OPTIONS, translationNoiseMm: [1, 1, Number.NaN] })).toThrow(RangeError);
  });
});
