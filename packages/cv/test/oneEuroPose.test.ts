import { describe, expect, it } from 'vitest';
import { estimateIntrinsics } from '../src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import { oneEuroAlpha, oneEuroPose, type OneEuroChannel } from '../src/filter/oneEuroPose.ts';
import { DEFAULT_MAX_GAP_MS, DEFAULT_MAX_PREDICTION_MS, DEFAULT_MAX_STALE_MS } from '../src/filter/poseFilter.ts';
import type { HeadPose } from '../src/pnp.ts';
import { solveHeadPose } from '../src/pnp.ts';
import { angleBetweenRotations, rotationMatrixFromVector } from '../src/rotation.ts';
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
} from './poseTruth.ts';
import { projectWithNoise } from './syntheticPose.ts';

const DT_MS = 1000 / 30;
const smoothOnly = (minCutoffHz: number): OneEuroChannel => ({ minCutoffHz, beta: 0, derivativeCutoffHz: 1 });
const tau = (cutoffHz: number) => 1 / (2 * Math.PI * cutoffHz);

/** Output std over input std of a first-order low-pass on white noise: sqrt(alpha / (2 - alpha)). */
const lowPassNoiseGain = (alpha: number) => Math.sqrt(alpha / (2 - alpha));

describe('oneEuroPose on a stationary pose with noise', () => {
  // With beta 0 the filter is an exponential moving average with alpha fixed
  // by the cutoff and dt. 6000 samples of an EMA with alpha near 0.2 have
  // about 650 independent ones, so the measured std is within 3% of its
  // expectation at one sigma; the bound allows 10%.
  it('reduces translation and rotation noise by sqrt(alpha / (2 - alpha))', () => {
    const random = seededRandom(101);
    const cutoff = 1;
    const filter = oneEuroPose({ rotation: smoothOnly(cutoff), translation: smoothOnly(cutoff) });
    const raw: HeadPose[] = [];
    const filtered: HeadPose[] = [];
    for (let k = 0; k < 6000; k++) {
      const measured = noisyPose(REST_POSE, random, 0.3 * DEG, [0.5, 0.5, 4]);
      raw.push(measured);
      filtered.push(filter.update(measured, k * DT_MS));
    }
    const expected = lowPassNoiseGain(oneEuroAlpha(cutoff, DT_MS / 1000));
    for (let axis = 0; axis < 3; axis++) {
      const translationRatio =
        standardDeviation(filtered.map((p) => p.translationMm[axis]!)) /
        standardDeviation(raw.map((p) => p.translationMm[axis]!));
      const rotationRatio =
        standardDeviation(filtered.map((p) => rotationError(p.rotation, REST_POSE.rotation)[axis]!)) /
        standardDeviation(raw.map((p) => rotationError(p.rotation, REST_POSE.rotation)[axis]!));
      expect(Math.abs(translationRatio / expected - 1)).toBeLessThan(0.1);
      expect(Math.abs(rotationRatio / expected - 1)).toBeLessThan(0.1);
    }
  });

  // The full chain: project the face model through known intrinsics, add
  // 0.5 px of landmark noise, solve, filter. The solver's pose noise is white
  // in time, so the low-pass gain above holds for it too; 2000 samples give
  // about 220 independent ones, so the bound allows 15%.
  it('reduces solveHeadPose noise from noisy landmarks by the same factor', () => {
    const random = seededRandom(102);
    const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 })!;
    const cutoff = 1.5;
    const filter = oneEuroPose({ rotation: smoothOnly(cutoff), translation: smoothOnly(cutoff) });
    const rawAngles: number[][] = [[], [], []];
    const filteredAngles: number[][] = [[], [], []];
    for (let k = 0; k < 2000; k++) {
      const pixels = projectWithNoise(REST_POSE, RIGID_FACE_LANDMARKS, intrinsics, 0.5, random);
      const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
      if (!solved.ok) throw new Error(solved.reason);
      const filtered = filter.update(solved, k * DT_MS);
      const rawError = rotationError(solved.rotation, REST_POSE.rotation);
      const filteredError = rotationError(filtered.rotation, REST_POSE.rotation);
      for (let axis = 0; axis < 3; axis++) {
        rawAngles[axis]!.push(rawError[axis]!);
        filteredAngles[axis]!.push(filteredError[axis]!);
      }
    }
    const expected = lowPassNoiseGain(oneEuroAlpha(cutoff, DT_MS / 1000));
    for (let axis = 0; axis < 3; axis++) {
      const ratio = standardDeviation(filteredAngles[axis]!) / standardDeviation(rawAngles[axis]!);
      expect(Math.abs(ratio / expected - 1)).toBeLessThan(0.15);
    }
  });
});

describe('oneEuroPose at constant velocity', () => {
  // Once the speed estimate has converged the cutoff is fixed at
  // minCutoff + beta * speed, and a first-order low-pass trails a ramp by
  // exactly tau = 1 / (2 pi cutoff) for any dt: e = (1 - alpha)(e + v dt) has
  // the fixed point v tau when alpha = dt / (dt + tau).
  const channel: OneEuroChannel = { minCutoffHz: 0.8, beta: 0.02, derivativeCutoffHz: 1 };
  const rotationChannel: OneEuroChannel = { minCutoffHz: 0.8, beta: 1.5, derivativeCutoffHz: 1 };
  const angularVelocity = [0.3, -0.5, 0.2] as const;
  const velocity = [120, -60, 40] as const;
  const angularSpeed = Math.hypot(...angularVelocity);

  const lagsAfterConvergence = (intervalsMs: readonly number[]) => {
    const filter = oneEuroPose({ rotation: rotationChannel, translation: channel });
    const times = frameTimes(intervalsMs);
    const lags: { rotationSeconds: number; translationSeconds: number[]; predictionErrorMm: number[] }[] = [];
    times.forEach((t, k) => {
      const truth = constantVelocityPose(REST_POSE, angularVelocity, velocity, t / 1000);
      const filtered = filter.update(truth, t);
      if (k < 400) return;
      const ahead = constantVelocityPose(REST_POSE, angularVelocity, velocity, (t + 30) / 1000);
      const predicted = filter.predict(t + 30)!;
      lags.push({
        rotationSeconds: angleBetweenRotations(filtered.rotation, truth.rotation) / angularSpeed,
        translationSeconds: [0, 1, 2].map((i) => (truth.translationMm[i]! - filtered.translationMm[i]!) / velocity[i]!),
        predictionErrorMm: [0, 1, 2].map((i) => ahead.translationMm[i]! - predicted.translationMm[i]!),
      });
    });
    return lags;
  };

  it('lags rotation and each translation axis by tau of its cutoff', () => {
    for (const lag of lagsAfterConvergence(Array(600).fill(DT_MS))) {
      expect(lag.rotationSeconds).toBeCloseTo(tau(rotationChannel.minCutoffHz + rotationChannel.beta * angularSpeed), 9);
      lag.translationSeconds.forEach((seconds, i) => {
        expect(seconds).toBeCloseTo(tau(channel.minCutoffHz + channel.beta * Math.abs(velocity[i]!)), 9);
      });
    }
  });

  it('keeps the same lag when the frame interval varies between 15 and 60 ms', () => {
    const random = seededRandom(103);
    const intervals = Array.from({ length: 600 }, () => random.uniform(15, 60));
    for (const lag of lagsAfterConvergence(intervals)) {
      expect(lag.rotationSeconds).toBeCloseTo(tau(rotationChannel.minCutoffHz + rotationChannel.beta * angularSpeed), 9);
      lag.translationSeconds.forEach((seconds, i) => {
        expect(seconds).toBeCloseTo(tau(channel.minCutoffHz + channel.beta * Math.abs(velocity[i]!)), 9);
      });
    }
  });

  // Extrapolating with the filtered velocity moves the estimate forward but
  // cannot remove the low-pass lag: the prediction still trails by v tau.
  it('predicts with the same lag it filters with', () => {
    for (const lag of lagsAfterConvergence(Array(600).fill(DT_MS))) {
      lag.predictionErrorMm.forEach((error, i) => {
        expect(error).toBeCloseTo(velocity[i]! * tau(channel.minCutoffHz + channel.beta * Math.abs(velocity[i]!)), 6);
      });
    }
  });
});

describe('oneEuroPose on a step', () => {
  const stepResponse = (channel: OneEuroChannel) => {
    const filter = oneEuroPose({ rotation: channel, translation: channel });
    const xs: number[] = [];
    for (let k = 0; k < 120; k++) {
      const x = k < 30 ? 0 : 50;
      const pose = { rotation: REST_POSE.rotation, translationMm: [x, 0, 600] as const };
      xs.push(filter.update(pose, k * DT_MS).translationMm[0]);
    }
    return xs.slice(30);
  };

  // With beta 0 the response after n frames is 1 - (1 - alpha)^n, so 90% takes
  // ceil(ln 0.1 / ln(1 - alpha)) frames. The speed term only raises the cutoff.
  it('reaches 90% in ceil(ln 0.1 / ln(1 - alpha)) frames with beta 0, and sooner with beta', () => {
    const cutoff = 1;
    const alpha = oneEuroAlpha(cutoff, DT_MS / 1000);
    const frames = Math.ceil(Math.log(0.1) / Math.log(1 - alpha));
    expect(firstReaching(stepResponse(smoothOnly(cutoff)), 0, 50, 0.9)).toBe(frames - 1);
    const fast = firstReaching(stepResponse({ minCutoffHz: cutoff, beta: 0.05, derivativeCutoffHz: 1 }), 0, 50, 0.9);
    expect(fast).toBeLessThan(frames - 1);
    expect(Math.max(...stepResponse({ minCutoffHz: cutoff, beta: 0.05, derivativeCutoffHz: 1 }))).toBeLessThanOrEqual(50);
  });
});

describe('oneEuroPose rotation through 180 degrees', () => {
  // quaternionFromMatrix returns w >= 0, so the measured quaternion changes
  // sign where the rotation angle passes pi. The filter differences rotations
  // on the tangent space and must not see a jump there.
  it('tracks a turn through pi with a constant lag and no jump', () => {
    const channel = smoothOnly(2);
    const filter = oneEuroPose({ rotation: channel, translation: channel });
    const axis = [0, 0, 1] as const;
    const speed = 1.5;
    // The angle passes pi at frame 90, after the lag has settled to 1e-9 s.
    const start: HeadPose = { rotation: rotationMatrixFromVector([0, 0, Math.PI - 3 * speed]), translationMm: [0, 0, 600] };
    for (let k = 0; k < 120; k++) {
      const t = k * DT_MS;
      const truth = constantVelocityPose(start, [axis[0] * speed, axis[1] * speed, axis[2] * speed], [0, 0, 0], t / 1000);
      const filtered = filter.update(truth, t);
      if (k > 60) expect(angleBetweenRotations(filtered.rotation, truth.rotation) / speed).toBeCloseTo(tau(2), 9);
    }
  });
});

describe('oneEuroPose state handling', () => {
  const channel: OneEuroChannel = { minCutoffHz: 1, beta: 0.01, derivativeCutoffHz: 1 };
  const at = (x: number): HeadPose => ({ rotation: REST_POSE.rotation, translationMm: [x, 0, 600] });

  it('restarts from the raw pose after a gap longer than maxGapMs, a reset or a repeated timestamp', () => {
    const filter = oneEuroPose({ rotation: channel, translation: channel });
    expect(filter.predict(0)).toBeNull();
    filter.update(at(0), 0);
    filter.update(at(10), DT_MS);
    expect(filter.update(at(40), DT_MS + DEFAULT_MAX_GAP_MS + 1).translationMm[0]).toBe(40);
    expect(filter.update(at(60), DT_MS + DEFAULT_MAX_GAP_MS + 1).translationMm[0]).toBe(60);
    filter.reset();
    expect(filter.predict(1000)).toBeNull();
    expect(filter.update(at(80), 1000).translationMm[0]).toBe(80);
  });

  it('continues across a gap up to maxGapMs', () => {
    const filter = oneEuroPose({ rotation: channel, translation: channel, maxGapMs: 300 });
    filter.update(at(0), 0);
    expect(filter.update(at(40), 300).translationMm[0]).toBeLessThan(40);
  });

  it('clamps the prediction horizon to [last update, last update + maxPredictionMs]', () => {
    const filter = oneEuroPose({ rotation: channel, translation: channel, maxPredictionMs: 50 });
    for (let k = 0; k < 100; k++) filter.update(at(k * 3), k * DT_MS);
    const last = 99 * DT_MS;
    const posterior = filter.predict(last)!.translationMm[0];
    expect(filter.predict(last - 20)!.translationMm[0]).toBe(posterior);
    expect(filter.predict(last + 150)!.translationMm[0]).toBeCloseTo(filter.predict(last + 50)!.translationMm[0], 12);
    expect(filter.predict(last + 50)!.translationMm[0]).toBeGreaterThan(posterior);
  });

  // After a hidden tab or a stalled worker the next update restarts the
  // filter, so its velocity no longer describes the head and must not move
  // the overlay.
  it('holds the pose at the horizon cap past maxGapMs and stops past maxStaleMs', () => {
    const filter = oneEuroPose({ rotation: channel, translation: channel });
    for (let k = 0; k < 30; k++) filter.update(at(k * 3), k * DT_MS);
    const last = 29 * DT_MS;
    const capped = filter.predict(last + DEFAULT_MAX_PREDICTION_MS)!;
    for (const aheadMs of [DEFAULT_MAX_GAP_MS + 1, 500, DEFAULT_MAX_STALE_MS]) {
      expect(filter.predict(last + aheadMs)).toEqual(capped);
    }
    expect(filter.predict(last + DEFAULT_MAX_STALE_MS + 1)).toBeNull();
    expect(filter.predict(Number.POSITIVE_INFINITY)).toBeNull();
  });

  // Updates further apart than maxGapMs each restart the filter at zero
  // velocity, so a worker that slow keeps its last pose on screen.
  it('keeps the last pose for updates further apart than maxGapMs', () => {
    const filter = oneEuroPose({ rotation: channel, translation: channel });
    const gapMs = DEFAULT_MAX_GAP_MS + 100;
    let filtered = filter.update(at(0), 0);
    for (let k = 1; k < 5; k++) {
      filtered = filter.update(at(30 * k), k * gapMs);
      expect(filtered.translationMm[0]).toBe(30 * k);
      expect(filter.predict((k + 1) * gapMs)).toEqual(filtered);
    }
  });

  it('rejects non-finite input and invalid parameters', () => {
    const filter = oneEuroPose({ rotation: channel, translation: channel });
    expect(() => filter.update(at(Number.NaN), 0)).toThrow(RangeError);
    expect(() => filter.update(at(0), Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => oneEuroPose({ rotation: { ...channel, minCutoffHz: 0 }, translation: channel })).toThrow(RangeError);
    expect(() => oneEuroPose({ rotation: channel, translation: channel, maxGapMs: 0 })).toThrow(RangeError);
  });
});
