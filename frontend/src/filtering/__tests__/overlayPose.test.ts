import { DEFAULT_MAX_GAP_MS, type HeadPose } from '@facefit/cv';
import { describe, expect, it } from 'vitest';
import { rotationFromDegrees } from '../../test/syntheticFace';
import {
  createOverlayPose,
  createPoseFilter,
  DEFAULT_POSE_FILTER,
  poseFilterSettingFrom,
} from '../overlayPose';

const FRAME_MS = 1000 / 30;
const ROTATION = rotationFromDegrees(-4, 12, 6);
const at = (xMm: number): HeadPose => ({ rotation: ROTATION, translationMm: [xMm, 0, 600] });

describe('poseFilterSettingFrom', () => {
  it('accepts the three settings and falls back to the default', () => {
    expect(poseFilterSettingFrom('off')).toBe('off');
    expect(poseFilterSettingFrom('one-euro')).toBe('one-euro');
    expect(poseFilterSettingFrom('kalman')).toBe('kalman');
    expect(poseFilterSettingFrom(undefined)).toBe(DEFAULT_POSE_FILTER);
    expect(poseFilterSettingFrom('Kalman')).toBe(DEFAULT_POSE_FILTER);
  });
});

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
