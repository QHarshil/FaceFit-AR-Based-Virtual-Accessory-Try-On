import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAX_GAP_MS,
  mat3Multiply,
  rotationMatrixFromVector,
  type HeadPose,
} from '@facefit/cv';
import { describe, expect, it } from 'vitest';
import { NUM_FACES } from '../../perception/landmarkerService';
import { rotationFromDegrees, seededGaussian } from '../../test/syntheticFace';
import {
  createOverlayPose,
  createPoseFilter,
  KALMAN_OPTIONS,
  MEASURED_POSE_NOISE,
  ONE_EURO_OPTIONS,
} from '../overlayPose';
import { DEFAULT_POSE_FILTER } from '../poseFilterSetting';

const FRAME_MS = 1000 / 30;
const ROTATION = rotationFromDegrees(-4, 12, 6);
const at = (xMm: number): HeadPose => ({ rotation: ROTATION, translationMm: [xMm, 0, 600] });

describe('createOverlayPose', () => {
  it('renders each solved pose as is when the filter is off', () => {
    const overlay = createOverlayPose('off');
    expect(overlay.poseForRender()).toBeNull();
    const pose = at(10);
    expect(overlay.update(pose, 0)).toBe(pose);
    overlay.present(FRAME_MS);
    expect(overlay.poseForRender()).toEqual({ pose, timestampMs: 0 });
    overlay.lose();
    expect(overlay.poseForRender()).toBeNull();
  });

  it.each(['one-euro', 'kalman'] as const)(
    '%s: predicts to the newest presented frame, never behind the last pose',
    (setting) => {
      const overlay = createOverlayPose(setting);
      const reference = createPoseFilter(setting)!;
      // A head moving 3 mm per frame along x.
      for (let k = 0; k < 30; k++) {
        overlay.update(at(3 * k), k * FRAME_MS);
        reference.update(at(3 * k), k * FRAME_MS);
      }
      const last = 29 * FRAME_MS;
      // A presented frame older than the last pose does not pull it back.
      overlay.present(last - FRAME_MS);
      expect(overlay.poseForRender()).toEqual({ pose: reference.predict(last), timestampMs: last });
      // The next frame is on screen while its landmarks are still in the worker.
      overlay.present(last + FRAME_MS);
      const ahead = overlay.poseForRender()!;
      expect(ahead).toEqual({
        pose: reference.predict(last + FRAME_MS),
        timestampMs: last + FRAME_MS,
      });
      expect(ahead.pose.translationMm[0]).toBeGreaterThan(
        reference.predict(last)!.translationMm[0],
      );
    },
  );

  it.each(['one-euro', 'kalman'] as const)(
    '%s: draws nothing once the newest frame is past the gap the filter survives',
    (setting) => {
      const overlay = createOverlayPose(setting);
      for (let k = 0; k < 30; k++) overlay.update(at(3 * k), k * FRAME_MS);
      const last = 29 * FRAME_MS;
      overlay.present(last + DEFAULT_MAX_GAP_MS);
      expect(overlay.poseForRender()).not.toBeNull();
      // A tab back from hidden: the frame on screen is far past the last pose.
      overlay.present(last + DEFAULT_MAX_GAP_MS + 1);
      expect(overlay.poseForRender()).toBeNull();
    },
  );

  it('starts a new track after the face is lost', () => {
    const overlay = createOverlayPose('one-euro');
    for (let k = 0; k < 10; k++) overlay.update(at(0), k * FRAME_MS);
    overlay.lose();
    expect(overlay.poseForRender()).toBeNull();
    // Without the reset the first pose of the new track would be smoothed toward x = 0.
    expect(overlay.update(at(50), 10 * FRAME_MS).translationMm[0]).toBe(50);
  });
});

interface SweepPoint {
  chosen: { params: unknown };
}

interface SweepSummary {
  configurations: { numFaces: number; oneEuro: SweepPoint; kalman: SweepPoint }[];
}

describe('the shipped filter', () => {
  // The sweep's rule picked the Kalman point; the live run overrode it
  // (docs/pose-filter.md). Both option sets stay the sweep's operating points.
  it('is One Euro, and each filter runs at its swept point for the configured numFaces', () => {
    // A path, not new URL(..., import.meta.url), which Vite rewrites to a served URL outside its root.
    const resultsFile = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../eval/results.json',
    );
    const results = JSON.parse(readFileSync(resultsFile, 'utf8')) as {
      runs: Record<string, SweepSummary>;
    };
    const swept = results.runs['pose-filter-sweep']!.configurations.find(
      (c) => c.numFaces === NUM_FACES,
    )!;
    expect(DEFAULT_POSE_FILTER).toBe('one-euro');
    expect(ONE_EURO_OPTIONS).toEqual(swept.oneEuro.chosen.params);
    expect(KALMAN_OPTIONS).toEqual(swept.kalman.chosen.params);
  });

  // A head moving 16 mm/s along x, about 30 px/s on screen at the recorded
  // distance, with the solved-pose noise measured on rec-static. 0.8 mm is
  // 50 ms at that speed, the lag target. Renders alternate between the last
  // pose's capture time and the next frame's, as in the app. Over 3600 renders
  // the standard error of the mean trail is under 0.05 mm, well inside the bound.
  it('trails a 16 mm/s ramp with the measured noise by at most 0.8 mm', () => {
    const gaussian = seededGaussian(16);
    const { rotationRad, translationMm } = MEASURED_POSE_NOISE;
    const overlay = createOverlayPose(DEFAULT_POSE_FILTER);
    const speedMmPerS = 16;
    const trail: number[] = [];
    for (let k = 0; k < 1860; k++) {
      const t = k * FRAME_MS;
      const noise = rotationMatrixFromVector([
        gaussian(rotationRad),
        gaussian(rotationRad),
        gaussian(rotationRad),
      ]);
      overlay.update(
        {
          rotation: mat3Multiply(noise, ROTATION),
          translationMm: [
            (speedMmPerS * t) / 1000 + gaussian(translationMm[0]),
            gaussian(translationMm[1]),
            600 + gaussian(translationMm[2]),
          ],
        },
        t,
      );
      if (k < 60) continue;
      for (const presented of [t, t + FRAME_MS]) {
        overlay.present(presented);
        const shown = overlay.poseForRender()!.pose.translationMm[0];
        trail.push((speedMmPerS * presented) / 1000 - shown);
      }
    }
    expect(trail.reduce((sum, v) => sum + v, 0) / trail.length).toBeLessThanOrEqual(0.8);
  });
});
