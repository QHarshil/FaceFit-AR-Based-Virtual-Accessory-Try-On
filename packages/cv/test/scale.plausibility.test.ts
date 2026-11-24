import { describe, expect, it } from 'vitest';
import { estimateIntrinsics } from '../src/camera.ts';
import { mat3Multiply, type Mat3, type Vec2 } from '../src/linalg.ts';
import type { HeadPose } from '../src/pnp.ts';
import { rotationMatrixFromVector } from '../src/rotation.ts';
import { DEFAULT_FACE_MEASUREMENT_LIMITS } from '../src/scale/aggregate.ts';
import { estimateFaceScale } from '../src/scale/faceScale.ts';
import { EYES } from '../src/scale/landmarks.ts';
import { measureTamperedClip, scaleIrisContour, shiftIris } from './irisTamper.ts';
import { seededRandom } from './random.ts';
import { AVERAGE_SUBJECT, renderSyntheticFace } from './syntheticFace.ts';

const DEG = Math.PI / 180;
const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 })!;
const pose: HeadPose = {
  rotation: mat3Multiply(rotationMatrixFromVector([0, 2 * DEG, 0]), rotationMatrixFromVector([3 * DEG, 0, 0])) as Mat3,
  translationMm: [0, 0, 550],
};
const clip = (tamper?: (landmarks: Vec2[]) => void, subject = AVERAGE_SUBJECT) =>
  measureTamperedClip({ subject, pose, intrinsics, sigmaPx: 0.5, count: 30, seed: 11, tamper });

describe('iris inside the eye', () => {
  it('rejects iris landmarks that sit outside the eye they are assigned to', () => {
    const { landmarksPx } = renderSyntheticFace(AVERAGE_SUBJECT, pose, intrinsics, 0, seededRandom(1));
    expect(estimateFaceScale(landmarksPx, pose, intrinsics).ok).toBe(true);
    // The eye is about 26 mm wide, 52 px at 550 mm: 40 px puts the iris centre past the corner.
    const sideways = landmarksPx.map((p) => [...p] as Vec2);
    shiftIris(sideways, 'left', [40, 0]);
    expect(estimateFaceScale(sideways, pose, intrinsics)).toEqual({ ok: false, reason: 'iris-outside-eye' });
    // An iris radius is about 12 px; 30 px above the eye line is past the upper lid and more than a radius out.
    const above = landmarksPx.map((p) => [...p] as Vec2);
    shiftIris(above, 'right', [0, -30]);
    expect(estimateFaceScale(above, pose, intrinsics)).toEqual({ ok: false, reason: 'iris-outside-eye' });
  });

  it('turns irises shifted off the eyes and shrunk to 0.8 into a failure, not a PD 25% high', () => {
    const tampered = clip((landmarks) => {
      for (const eye of EYES) {
        shiftIris(landmarks, eye, [60, 25]);
        scaleIrisContour(landmarks, eye, 0.8);
      }
    });
    expect(tampered.summary.ok).toBe(false);
    expect(tampered.summary.rejectedFrames['iris-outside-eye']).toBe(30);
  });

  it('keeps the closed-eye frames under eyes-closed: an iris within a radius of the eye line is inside', () => {
    const { landmarksPx } = renderSyntheticFace(AVERAGE_SUBJECT, pose, intrinsics, 0, seededRandom(2), { eyeOpenness: 0.02, irisShrink: 0.15 });
    expect(estimateFaceScale(landmarksPx, pose, intrinsics).ok).toBe(true);
  });
});

describe('plausible face scale', () => {
  /*
   * The canonical eye spacing is 63 mm, the adult mean PD, so the face scale
   * is about PD over 63 mm times the assumed over the true iris diameter.
   * PD runs from about 41 mm (young children) to 78 mm (largest adults) and
   * the iris from 10.2 to 13.2 mm (3 SD), so 41 / 63 x 11.7 / 13.2 = 0.58 and
   * 78 / 63 x 11.7 / 10.2 = 1.42 bound real faces.
   */
  it('states a range that admits small and large real faces', () => {
    expect(DEFAULT_FACE_MEASUREMENT_LIMITS.minFaceScale).toBeLessThanOrEqual(0.58);
    expect(DEFAULT_FACE_MEASUREMENT_LIMITS.maxFaceScale).toBeGreaterThanOrEqual(1.42);
    for (const faceScale of [0.62, 1.38]) {
      const real = clip(undefined, { ...AVERAGE_SUBJECT, faceScale, distancePdMm: 63 * faceScale });
      expect(real.summary.ok, `face scale ${faceScale}`).toBe(true);
    }
  });

  it('rejects frames whose iris implies a face scale outside the range', () => {
    // Contours at 0.6 imply a face 1 / 0.6 = 1.67 times the canonical one; at 2, half of it.
    for (const factor of [0.6, 2]) {
      const tampered = clip((landmarks) => EYES.forEach((eye) => scaleIrisContour(landmarks, eye, factor)));
      expect(tampered.summary.ok, `contour x${factor}`).toBe(false);
      expect(tampered.summary.rejectedFrames['implausible-scale'], `contour x${factor}`).toBe(30);
    }
  });
});
