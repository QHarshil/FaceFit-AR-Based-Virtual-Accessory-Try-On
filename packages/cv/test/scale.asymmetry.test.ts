import { describe, expect, it } from 'vitest';
import { estimateIntrinsics } from '../src/camera.ts';
import { mat3Multiply, type Mat3, type Vec2 } from '../src/linalg.ts';
import type { HeadPose } from '../src/pnp.ts';
import { rotationMatrixFromVector } from '../src/rotation.ts';
import type { MeasurementInterval } from '../src/scale/aggregate.ts';
import { estimateFaceScale } from '../src/scale/faceScale.ts';
import { measureTamperedClip, pushHorizontalPoint, scaleIrisContour } from './irisTamper.ts';
import { seededRandom } from './random.ts';
import { AVERAGE_SUBJECT, renderSyntheticFace } from './syntheticFace.ts';

const DEG = Math.PI / 180;
const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 })!;
const pose: HeadPose = {
  rotation: mat3Multiply(rotationMatrixFromVector([0, 2 * DEG, 0]), rotationMatrixFromVector([3 * DEG, 0, 0])) as Mat3,
  translationMm: [0, 0, 550],
};
const SIGMA_PX = 0.5;
const FRAMES = 60;
const clip = (tamper?: (landmarks: Vec2[], frame: number) => void, seed = 21) => {
  let frame = 0;
  return measureTamperedClip({
    subject: AVERAGE_SUBJECT,
    pose,
    intrinsics,
    sigmaPx: SIGMA_PX,
    count: FRAMES,
    seed,
    tamper: tamper && ((landmarks) => tamper(landmarks, frame++)),
  });
};
const covers = (interval: MeasurementInterval, truth: number) => interval.lowerMm <= truth && truth <= interval.upperMm;

/*
 * Noise bound for near PD at 0.5 px and 550 mm: the iris is 23.6 px and PD
 * 127 px wide. With one eye's diameter, the per-frame relative SD is
 * 0.5 sqrt(2 / 23.6^2 + 0.44 / 127^2) = 3.0%; the median of 60 frames is
 * within 4 standard errors (1.2533 x 3.0% / sqrt(60) = 0.49%) plus the 0.3%
 * second-order allowance the accuracy tests use: 2.3%.
 */
const NOISE_BOUND = 4 * 1.2533 * 0.5 * Math.sqrt(2 / 23.6 ** 2 + 0.44 / 127 ** 2) / Math.sqrt(FRAMES) + 0.003;

describe('asymmetric irises', () => {
  it('measures a clean clip within the noise bound', () => {
    const { summary, truth } = clip();
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;
    expect(Math.abs(summary.nearPupillaryDistance.medianMm / truth.nearPdMm - 1)).toBeLessThan(NOISE_BOUND);
  });

  it('fails a clip where one iris contour reads 0.8 or 1.2 times the other, or covers the truth', () => {
    for (const factor of [0.8, 1.2]) {
      const { summary, truth } = clip((landmarks) => scaleIrisContour(landmarks, 'left', factor));
      if (summary.ok) {
        expect(covers(summary.nearPupillaryDistance, truth.nearPdMm), `contour x${factor}`).toBe(true);
      } else {
        expect(summary.reason, `contour x${factor}`).toBe('asymmetric-iris');
        expect(summary.rejectedFrames['asymmetric-iris'], `contour x${factor}`).toBeGreaterThan(FRAMES / 2);
      }
    }
  });

  /*
   * At 0.5 px each eye's diameter has 3% SD and the ratio 4.2%, so the gate
   * widens to 3 x 4.2% = 12.6%. A contour at 0.75 (log ratio 0.29) clears it
   * by 3.9 SD in every faulty frame.
   */
  it('gates the frames where one contour is off and measures the rest', () => {
    const { summary, truth } = clip((landmarks, frame) => {
      if (frame % 5 === 0) scaleIrisContour(landmarks, 'left', 0.75);
    });
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;
    expect(summary.rejectedFrames['asymmetric-iris']).toBe(FRAMES / 5);
    expect(Math.abs(summary.nearPupillaryDistance.medianMm / truth.nearPdMm - 1)).toBeLessThan(NOISE_BOUND);
  });

  it('keeps PD within the noise bound when one horizontal contour point sits 0.3 radius outward', () => {
    for (const fraction of [0.3, 0.45]) {
      const { summary, truth } = clip((landmarks) => pushHorizontalPoint(landmarks, 'left', fraction));
      expect(summary.ok, `push ${fraction}`).toBe(true);
      if (!summary.ok) continue;
      expect(Math.abs(summary.nearPupillaryDistance.medianMm / truth.nearPdMm - 1), `push ${fraction}`).toBeLessThan(NOISE_BOUND);
    }
  });

  it('sets the scale from the other eye when one horizontal point explains the disagreement', () => {
    const { landmarksPx } = renderSyntheticFace(AVERAGE_SUBJECT, pose, intrinsics, 0, seededRandom(3));
    const clean = estimateFaceScale(landmarksPx, pose, intrinsics);
    const pushed = landmarksPx.map((p) => [...p] as Vec2);
    pushHorizontalPoint(pushed, 'left', 0.3);
    const fit = estimateFaceScale(pushed, pose, intrinsics);
    expect(clean.ok && fit.ok).toBe(true);
    if (!clean.ok || !fit.ok) return;
    expect(clean.irisDiameterRatio).toBeCloseTo(1, 2);
    expect(fit.eyesUsed).toEqual(['right']);
    expect(fit.irisDiameterRatio).toBeNull();
    expect(Math.abs(fit.faceScale / clean.faceScale - 1)).toBeLessThan(1e-3);
  });

  /*
   * At 1 px and 750 mm the iris is 17 px and each eye's diameter has 8% SD,
   * so the ratio of the two scatters by 12% per frame with nothing wrong.
   * The gate widens to 3 MAD-based SDs of the clip's own ratios, and the clip
   * median of the ratio, within 0.25% of 1, passes.
   */
  it('does not fail a symmetric clip whose per-frame ratio is noisy', () => {
    const far: HeadPose = { ...pose, translationMm: [0, 0, 750] };
    const { summary } = measureTamperedClip({ subject: AVERAGE_SUBJECT, pose: far, intrinsics, sigmaPx: 1, count: 40, seed: 23 });
    expect(summary.ok).toBe(true);
    expect(summary.rejectedFrames['asymmetric-iris']).toBeLessThan(4);
  });
});
