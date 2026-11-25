import {
  oneEuroPose,
  poseKalman,
  type HeadPose,
  type OneEuroPoseOptions,
  type PoseFilter,
  type PoseKalmanOptions,
} from '@facefit/cv';
import { parsePoseFilterSetting, type PoseFilterSetting } from './poseFilterSetting';

/** Build-time setting; the eval harness turns the filter off to record raw poses. */
export const POSE_FILTER = parsePoseFilterSetting(import.meta.env.VITE_POSE_FILTER);

/**
 * Operating points of each filter for `numFaces` 2 from the parameter sweep,
 * `runs["pose-filter-sweep"]` in eval/results.json: the least jitter on the
 * recorded still clip with the worst lag across speeds under 50 ms
 * (docs/pose-filter.md).
 */
export const ONE_EURO_OPTIONS: OneEuroPoseOptions = {
  rotation: { minCutoffHz: 0.2, beta: 100, derivativeCutoffHz: 0.25 },
  translation: { minCutoffHz: 4, beta: 0.01, derivativeCutoffHz: 2 },
};

/**
 * Noise of the solved pose on the recorded still clip with `numFaces` 2, per
 * axis (`solvedPoseNoise` in the sweep). The Kalman filter's measurement noise.
 */
export const MEASURED_POSE_NOISE = {
  rotationRad: 0.008877,
  translationMm: [0.8784, 0.6203, 2.853],
} as const;

export const KALMAN_OPTIONS: PoseKalmanOptions = {
  angularAccelerationNoise: 0.1392,
  linearAccelerationNoiseMm: 64.63,
  rotationNoiseRad: MEASURED_POSE_NOISE.rotationRad,
  translationNoiseMm: MEASURED_POSE_NOISE.translationMm,
};

export const createPoseFilter = (setting: PoseFilterSetting): PoseFilter | null => {
  switch (setting) {
    case 'off':
      return null;
    case 'one-euro':
      return oneEuroPose(ONE_EURO_OPTIONS);
    case 'kalman':
      return poseKalman(KALMAN_OPTIONS);
  }
};

/**
 * The head pose the overlay draws, between the solver and the renderer.
 *
 * Each solved pose is filtered at its frame's capture time. A render draws the
 * filtered pose predicted to the capture time of the newest camera frame on
 * screen: the overlay is composited over that frame, and its landmarks are
 * still in the worker. Predicting to the render's wall-clock time instead
 * would put the overlay ahead of the video it sits on.
 */
export interface OverlayPose {
  readonly setting: PoseFilterSetting;
  /** A trusted pose for the frame captured at `timestampMs`. Returns the filtered pose. */
  update(pose: HeadPose, timestampMs: number): HeadPose;
  /** The face is gone; the next pose starts a new track. */
  lose(): void;
  /** A camera frame captured at `timestampMs` is now on screen. */
  present(timestampMs: number): void;
  /**
   * Pose for the current render. Null before the first pose, after a loss, and
   * when the newest frame is past the gap the filter survives.
   */
  poseForRender(): RenderPose | null;
}

export interface RenderPose {
  readonly pose: HeadPose;
  /** Capture time the pose is for: the newest presented frame's, or the last pose's if later. */
  readonly timestampMs: number;
}

export const createOverlayPose = (setting: PoseFilterSetting = POSE_FILTER): OverlayPose => {
  const filter = createPoseFilter(setting);
  let latest: { pose: HeadPose; timestampMs: number } | null = null;
  let presentedMs = Number.NEGATIVE_INFINITY;

  return {
    setting,
    update(pose, timestampMs) {
      const filtered = filter ? filter.update(pose, timestampMs) : pose;
      latest = { pose: filtered, timestampMs };
      return filtered;
    },
    lose() {
      latest = null;
      filter?.reset();
    },
    present(timestampMs) {
      presentedMs = Math.max(presentedMs, timestampMs);
    },
    poseForRender() {
      if (!latest) return null;
      if (!filter) return latest;
      const timestampMs = Math.max(presentedMs, latest.timestampMs);
      const pose = filter.predict(timestampMs);
      return pose && { pose, timestampMs };
    },
  };
};
