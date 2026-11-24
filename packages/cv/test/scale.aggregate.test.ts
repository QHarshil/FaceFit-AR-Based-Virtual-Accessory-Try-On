import { describe, expect, it } from 'vitest';
import { estimateIntrinsics } from '../src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import { mat3Multiply, type Mat3, type Vec2, type Vec3 } from '../src/linalg.ts';
import { solveHeadPose, type HeadPose, type HeadPoseResult } from '../src/pnp.ts';
import { rotationMatrixFromVector } from '../src/rotation.ts';
import { aggregateFaceMeasurements, DEFAULT_FACE_MEASUREMENT_LIMITS, type FaceMeasurementResult } from '../src/scale/aggregate.ts';
import { measureFaceFrame, type FaceFrame, type FaceFrameResult } from '../src/scale/frame.ts';
import { seededRandom, type SeededRandom } from './random.ts';
import { AVERAGE_SUBJECT, renderSyntheticFace, type SyntheticFrameOptions } from './syntheticFace.ts';

const DEG = Math.PI / 180;
const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 })!;
const SUBJECT = { ...AVERAGE_SUBJECT, faceScale: 0.97, distancePdMm: 61 };
const RELATIVE_POPULATION_SD = 0.5 / 11.7;
const Z_95 = 1.959964;

function poseAt(yawDeg: number, pitchDeg: number, translationMm: Vec3): HeadPose {
  const yaw = rotationMatrixFromVector([0, yawDeg * DEG, 0]);
  const pitch = rotationMatrixFromVector([pitchDeg * DEG, 0, 0]);
  return { rotation: mat3Multiply(yaw, pitch) as Mat3, translationMm };
}

function solve(landmarksPx: readonly Vec2[]): HeadPoseResult {
  return solveHeadPose(
    RIGID_FACE_LANDMARKS.map(({ landmarkIndex }) => landmarksPx[landmarkIndex]!),
    RIGID_FACE_LANDMARKS,
    intrinsics,
  );
}

interface Rendered {
  readonly frame: FaceFrameResult;
  readonly truthNearPdMm: number;
}

/**
 * 0.3 px of landmark noise puts eye openness at about 2.6% SD per frame, so
 * the 0.9 relative floor sits near 4 SD below the open-eye median.
 * eval/results.json records the spread on the recordings as
 * openFrameOpennessSdPercent.
 */
const SIGMA_PX = 0.3;

function render(random: SeededRandom, pose: HeadPose, options: SyntheticFrameOptions = {}, rigidExtraSigmaPx = 0): Rendered {
  const rendered = renderSyntheticFace(SUBJECT, pose, intrinsics, SIGMA_PX, random, options);
  const landmarks = rendered.landmarksPx.map((p) => [...p] as Vec2);
  for (const { landmarkIndex } of RIGID_FACE_LANDMARKS) {
    const p = landmarks[landmarkIndex]!;
    landmarks[landmarkIndex] = [p[0] + random.gaussian(rigidExtraSigmaPx), p[1] + random.gaussian(rigidExtraSigmaPx)];
  }
  return { frame: measureFaceFrame(landmarks, solve(landmarks), intrinsics), truthNearPdMm: rendered.truth.nearPdMm };
}

function okFrame(overrides: Partial<FaceFrame> = {}): FaceFrame {
  return {
    ok: true,
    lineOfSightYawDeg: 1,
    lineOfSightPitchDeg: -4,
    eyeOpenness: 0.31,
    rmsReprojectionMm: 1.5,
    maxRotationStdDeg: 0.6,
    faceScale: 1,
    irisDepthMm: 520,
    nearPdMm: 62,
    distancePdMm: 63.3,
    distancePdCorrectionSdMm: 0.3,
    faceWidthMm: 140,
    faceWidthModelSdMm: 2,
    ...overrides,
  };
}

function expectNoNaN(result: FaceMeasurementResult): void {
  const numbers: number[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'number') numbers.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(result);
  expect(numbers.every(Number.isFinite)).toBe(true);
}

describe('aggregateFaceMeasurements', () => {
  /*
   * Off-axis frames here look along a head turned 20 degrees, which
   * overstates PD by 1 / cos(20) - 1 = 6%; blink frames shrink the iris
   * contour by 15%, as MediaPipe's does, which overstates PD by 18%, and
   * partial blinks at 0.7 of the open-eye openness shrink it by 4%.
   * Untrusted frames carry 10 px of extra noise on the rigid landmarks, a
   * reprojection RMS near 7 mm. Each kind is counted under its reason and
   * kept out of the median.
   */
  it('rejects blinks, off-axis, untrusted and failed frames and recovers PD from the rest', () => {
    const random = seededRandom(501);
    const good = poseAt(3, 4, [10, -15, 560]);
    const turned = poseAt(20, 4, [10, -15, 560]);
    const truth = render(seededRandom(1), good).truthNearPdMm;
    const frames: FaceFrameResult[] = [];
    for (let k = 0; k < 40; k++) {
      frames.push(render(random, good).frame);
      if (k % 10 === 4) {
        frames.push(render(random, good, { eyeOpenness: 0.04, irisShrink: 0.15 }).frame);
        frames.push(render(random, good, { eyeOpenness: 0.04, irisShrink: 0.15 }).frame);
        frames.push(render(random, good, { eyeOpenness: 0.22, irisShrink: 0.04 }).frame);
      }
      if (k % 4 === 1) frames.push(render(random, turned, { gaze: 'head' }).frame);
    }
    for (let k = 0; k < 3; k++) {
      frames.push(render(random, good, {}, 10).frame);
      frames.push({ ok: false, reason: 'no-face' });
      frames.push({ ok: false, reason: 'pose-failed' });
    }

    const result = aggregateFaceMeasurements(frames);
    expectNoNaN(result);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.acceptedFrames).toBe(40);
    expect(result.rejectedFrames).toEqual({
      'no-face': 3,
      'pose-failed': 3,
      'measurement-failed': 0,
      'untrusted-pose': 3,
      'off-axis': 10,
      'eyes-closed': 12,
    });
    // 40 frames at 1.3% per-frame SD: 4 standard errors of the median is 1%.
    expect(Math.abs(result.nearPupillaryDistance.medianMm / truth - 1)).toBeLessThan(0.01);

    const ungated = aggregateFaceMeasurements(frames, {
      maxYawDeg: 90,
      maxPitchDeg: 90,
      maxRmsReprojectionMm: 100,
      maxRotationStdDeg: 90,
      minEyeOpenness: 0,
      minRelativeEyeOpenness: 0,
    });
    // With 25 of 65 frames biased upward, the ungated median moves up by about one frame SD (1.3%).
    expect(ungated.ok && ungated.acceptedFrames).toBe(65);
    expect(ungated.ok && ungated.nearPupillaryDistance.medianMm / result.nearPupillaryDistance.medianMm - 1).toBeGreaterThan(0.008);
  });

  it('returns too-few-frames with counts and no NaN when too little is accepted', () => {
    const random = seededRandom(502);
    const frames = Array.from({ length: 5 }, () => render(random, poseAt(0, 0, [0, 0, 500])).frame);
    const result = aggregateFaceMeasurements([...frames, { ok: false, reason: 'no-face' }]);
    expect(result).toMatchObject({ ok: false, reason: 'too-few-frames', acceptedFrames: 5 });
    expect(result.rejectedFrames['no-face']).toBe(1);
    expectNoNaN(result);
    expect(aggregateFaceMeasurements([])).toMatchObject({ ok: false, reason: 'too-few-frames', acceptedFrames: 0 });
  });

  it('rejects invalid limits', () => {
    expect(aggregateFaceMeasurements([okFrame()], { maxYawDeg: Number.NaN })).toMatchObject({ ok: false, reason: 'invalid-limits' });
    expect(aggregateFaceMeasurements([okFrame()], { minAcceptedFrames: 1 })).toMatchObject({ ok: false, reason: 'invalid-limits' });
  });

  it('treats a pose without uncertainty as untrusted', () => {
    const frames = Array.from({ length: 12 }, () => okFrame({ maxRotationStdDeg: null }));
    const result = aggregateFaceMeasurements(frames);
    expect(result).toMatchObject({ ok: false, acceptedFrames: 0 });
    expect(result.rejectedFrames['untrusted-pose']).toBe(12);
  });

  it('builds the interval from population, noise and model terms', () => {
    const constant = Array.from({ length: 20 }, () => okFrame());
    const result = aggregateFaceMeasurements(constant);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const near = result.nearPupillaryDistance;
    expect(near.noiseSdMm).toBe(0);
    expect(near.populationSdMm).toBeCloseTo(62 * RELATIVE_POPULATION_SD, 12);
    expect(near.upperMm - near.medianMm).toBeCloseTo(Z_95 * 62 * RELATIVE_POPULATION_SD, 9);
    const distance = result.distancePupillaryDistance;
    expect(distance.modelSdMm).toBeCloseTo(0.3, 12);
    expect(distance.upperMm - distance.medianMm).toBeCloseTo(Z_95 * Math.hypot(63.3 * RELATIVE_POPULATION_SD, 0.3), 9);
    expect(result.faceWidth.upperMm - result.faceWidth.medianMm).toBeCloseTo(Z_95 * Math.hypot(140 * RELATIVE_POPULATION_SD, 2), 9);
  });

  /*
   * A slowly drifting sequence carries less information than its length:
   * an AR(1) process with coefficient 0.9 has n_eff = n (0.1 / 1.9), about
   * 5% of the frames. The sample coefficient from 400 frames is within 0.05
   * of 0.9 with high probability, so n_eff stays under 10% of n.
   */
  it('discounts autocorrelated frames', () => {
    const random = seededRandom(503);
    let drift = 0;
    const frames = Array.from({ length: 400 }, () => {
      drift = 0.9 * drift + random.gaussian(0.3);
      return okFrame({ nearPdMm: 62 + drift });
    });
    const result = aggregateFaceMeasurements(frames);
    expect(result.ok && result.nearPupillaryDistance.effectiveFrames).toBeLessThan(40);
    const independent = Array.from({ length: 400 }, () => okFrame({ nearPdMm: 62 + random.gaussian(0.7) }));
    const reference = aggregateFaceMeasurements(independent);
    expect(reference.ok && reference.nearPupillaryDistance.effectiveFrames).toBeGreaterThan(300);
  });

  it('applies the openness floor relative to the median of the frames that pass the pose gates', () => {
    const frames = [
      ...Array.from({ length: 20 }, () => okFrame({ eyeOpenness: 0.3 })),
      ...Array.from({ length: 4 }, () => okFrame({ eyeOpenness: 0.26 })),
      ...Array.from({ length: 4 }, () => okFrame({ eyeOpenness: 0.12, lineOfSightYawDeg: 30 })),
    ];
    const result = aggregateFaceMeasurements(frames);
    expect(result.ok && result.acceptedFrames).toBe(20);
    expect(result.rejectedFrames['eyes-closed']).toBe(4);
    expect(result.rejectedFrames['off-axis']).toBe(4);
    expect(DEFAULT_FACE_MEASUREMENT_LIMITS.minRelativeEyeOpenness * 0.3).toBeGreaterThan(0.26);
  });
});
