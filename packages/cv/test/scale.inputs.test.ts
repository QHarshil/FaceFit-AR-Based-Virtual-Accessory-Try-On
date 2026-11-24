import { describe, expect, it } from 'vitest';
import { estimateIntrinsics } from '../src/camera.ts';
import type { Mat3, Vec2 } from '../src/linalg.ts';
import type { HeadPose, HeadPoseSolution } from '../src/pnp.ts';
import { estimateFaceScale } from '../src/scale/faceScale.ts';
import { measureFaceFrame } from '../src/scale/frame.ts';
import { measureFaceWidth, measurePupillaryDistance, nearToDistancePd } from '../src/scale/measurements.ts';
import { seededRandom } from './random.ts';
import { AVERAGE_SUBJECT, renderSyntheticFace } from './syntheticFace.ts';

const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 })!;
const pose: HeadPose = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [0, 0, 550] };
const { landmarksPx } = renderSyntheticFace(AVERAGE_SUBJECT, pose, intrinsics, 0, seededRandom(1));
const withPoint = (index: number, point: Vec2): Vec2[] => landmarksPx.map((p, i) => (i === index ? point : p));
const scaled: Mat3 = [2, 0, 0, 0, 1, 0, 0, 0, 1];

describe('metric scale input checks', () => {
  it('estimateFaceScale names the bad input', () => {
    expect(estimateFaceScale(landmarksPx.slice(0, 468), pose, intrinsics)).toEqual({ ok: false, reason: 'missing-landmarks' });
    expect(estimateFaceScale(withPoint(470, [Number.NaN, 0]), pose, intrinsics)).toEqual({ ok: false, reason: 'missing-landmarks' });
    expect(estimateFaceScale(landmarksPx, { ...pose, rotation: scaled }, intrinsics)).toEqual({ ok: false, reason: 'invalid-pose' });
    expect(estimateFaceScale(landmarksPx, { ...pose, translationMm: [0, 0, -5] }, intrinsics)).toEqual({ ok: false, reason: 'invalid-pose' });
    expect(estimateFaceScale(landmarksPx, pose, { ...intrinsics, fx: 0 })).toEqual({ ok: false, reason: 'invalid-intrinsics' });
    expect(estimateFaceScale(landmarksPx, pose, intrinsics, { irisDiameterMm: 0 })).toEqual({ ok: false, reason: 'invalid-options' });
  });

  it('measures PD and face width only from a valid pose and landmarks', () => {
    const scale = estimateFaceScale(landmarksPx, pose, intrinsics);
    expect(scale.ok).toBe(true);
    if (!scale.ok) return;
    expect(measurePupillaryDistance(scale, { ...pose, rotation: scaled })).toEqual({ ok: false, reason: 'invalid-pose' });
    expect(measureFaceWidth(withPoint(356, [Number.NaN, 1]), pose, intrinsics, scale)).toEqual({ ok: false, reason: 'missing-landmarks' });
    expect(measureFaceWidth(landmarksPx.slice(0, 400), pose, intrinsics, scale)).toEqual({ ok: false, reason: 'missing-landmarks' });
  });

  it('nearToDistancePd inverts the convergence model and rejects implausible input', () => {
    const near = 64 * (1 - 10.5 / 500);
    const converted = nearToDistancePd(near, 500);
    expect(converted.ok && converted.distancePdMm).toBeCloseTo(64, 10);
    expect(converted.ok && converted.correctionMm).toBeCloseTo(64 - near, 10);
    expect(converted.ok && converted.correctionSdMm).toBeGreaterThan(0);
    for (const [pd, distance] of [[Number.NaN, 500], [0, 500], [-60, 500], [60, 100], [60, Number.POSITIVE_INFINITY]]) {
      expect(nearToDistancePd(pd!, distance!)).toEqual({ ok: false, reason: 'invalid-input' });
    }
  });

  it('measureFaceFrame maps a missing face, a failed pose and missing lids', () => {
    const solved: HeadPoseSolution = { ok: true, ...pose, rmsReprojectionPx: 0.5, inlierIndices: [], iterations: 1 };
    expect(measureFaceFrame(null, solved, intrinsics)).toEqual({ ok: false, reason: 'no-face' });
    expect(measureFaceFrame(landmarksPx, null, intrinsics)).toEqual({ ok: false, reason: 'pose-failed' });
    expect(measureFaceFrame(landmarksPx, { ok: false, reason: 'no-solution' }, intrinsics)).toEqual({ ok: false, reason: 'pose-failed' });
    expect(measureFaceFrame(withPoint(159, [Number.NaN, 0]), solved, intrinsics)).toEqual({ ok: false, reason: 'missing-landmarks' });
    const frame = measureFaceFrame(landmarksPx, solved, intrinsics);
    expect(frame.ok && frame.maxRotationStdDeg).toBeNull();
  });
});
