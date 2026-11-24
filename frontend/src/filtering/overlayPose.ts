import {
  oneEuroPose,
  poseKalman,
  type HeadPose,
  type OneEuroPoseOptions,
  type PoseFilter,
  type PoseKalmanOptions,
} from '@facefit/cv';

/** Which temporal filter smooths the head pose; `off` renders each solved pose as is. */
export type PoseFilterSetting = 'off' | 'one-euro' | 'kalman';

export const DEFAULT_POSE_FILTER: PoseFilterSetting = 'one-euro';

export const poseFilterSettingFrom = (value: string | undefined): PoseFilterSetting =>
  value === 'off' || value === 'one-euro' || value === 'kalman' ? value : DEFAULT_POSE_FILTER;

/** Build-time setting; the eval harness turns the filter off to record raw poses. */
export const POSE_FILTER = poseFilterSettingFrom(import.meta.env.VITE_POSE_FILTER);

/** Operating points from the parameter sweep in docs/pose-filter.md. */
export const ONE_EURO_OPTIONS: OneEuroPoseOptions = {
  rotation: { minCutoffHz: 1, beta: 0.5, derivativeCutoffHz: 1 },
  translation: { minCutoffHz: 1, beta: 0.01, derivativeCutoffHz: 1 },
};

export const KALMAN_OPTIONS: PoseKalmanOptions = {
  angularAccelerationNoise: 1,
  linearAccelerationNoiseMm: 100,
  rotationNoiseRad: (0.2 * Math.PI) / 180,
  translationNoiseMm: [0.5, 0.5, 5],
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
  /** Pose for the current render, or null before the first pose and after a loss. */
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
