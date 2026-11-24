import {
  estimateIntrinsics,
  RIGID_FACE_LANDMARKS,
  solveHeadPose,
  type CameraIntrinsics,
  type HeadPose,
  type HeadPoseFailureReason,
  type HeadPoseResult,
  type Vec2,
} from '@facefit/cv';
import { hasFace, landmarkPoint, type LandmarkFrame } from '../perception/types';

/**
 * Horizontal field of view assumed for an uncalibrated webcam, in degrees.
 * An assumption, not a calibration. A wrong value scales the solved depth with
 * the focal length, so the rendered size in pixels changes little, and the
 * AFLW2000 sweep in docs/pose-benchmark.md shows rotation error changing
 * little across 40 to 70 degrees.
 */
export const DEFAULT_HORIZONTAL_FOV_DEG = 60;

/**
 * Largest trusted reprojection RMS, in millimetres at the face's depth. The
 * RMS in pixels grows with the face's size in the image, from landmark noise
 * and from the gap between the wearer's face and the canonical one, so the gate
 * divides by the image scale (focal length over depth) to treat near and far
 * faces alike. The value sits above what the eval harness measures for a
 * still face and through blinks (`summary.solver` in eval/results.json), so a
 * blink does not hide the frame, and well below solves on badly displaced
 * landmarks.
 */
export const MAX_RMS_REPROJECTION_MM = 6;

export type GateReason = 'no-face' | 'invalid-frame-size' | HeadPoseFailureReason | 'reprojection';

export interface HeadPoseFit {
  readonly pose: HeadPose;
  readonly rmsReprojectionPx: number;
  /** rmsReprojectionPx times depth over focal length. */
  readonly rmsReprojectionMm: number;
  readonly inlierCount: number;
}

export type HeadPoseEstimate =
  | { readonly trusted: true; readonly intrinsics: CameraIntrinsics; readonly fit: HeadPoseFit }
  | {
      readonly trusted: false;
      readonly reason: GateReason;
      readonly intrinsics: CameraIntrinsics | null;
      /** Present when the solve succeeded and only the reprojection gate rejected it. */
      readonly fit: HeadPoseFit | null;
    };

/** Normalized landmarks to pixels of the frame they were detected in. */
export function landmarksToPixels(frame: LandmarkFrame, indices: readonly number[]): Vec2[] {
  return indices.map((index) => {
    const { x, y } = landmarkPoint(frame, index);
    return [x * frame.width, y * frame.height];
  });
}

/** Trusts a solve when it succeeded and its reprojection RMS is at most `maxRmsMm`. */
export function gateHeadPose(
  result: HeadPoseResult,
  intrinsics: CameraIntrinsics,
  maxRmsMm: number = MAX_RMS_REPROJECTION_MM,
): HeadPoseEstimate {
  if (!result.ok) return { trusted: false, reason: result.reason, intrinsics, fit: null };
  const fit: HeadPoseFit = {
    pose: { rotation: result.rotation, translationMm: result.translationMm },
    rmsReprojectionPx: result.rmsReprojectionPx,
    rmsReprojectionMm: (result.rmsReprojectionPx * result.translationMm[2]) / intrinsics.fx,
    inlierCount: result.inlierIndices.length,
  };
  if (!(fit.rmsReprojectionMm <= maxRmsMm)) {
    return { trusted: false, reason: 'reprojection', intrinsics, fit };
  }
  return { trusted: true, intrinsics, fit };
}

export interface HeadPoseTrackerOptions {
  readonly horizontalFovDeg?: number;
  readonly maxRmsReprojectionMm?: number;
}

export interface HeadPoseTracker {
  update(frame: LandmarkFrame): HeadPoseEstimate;
  reset(): void;
}

/**
 * Solves the head pose per landmark frame with intrinsics estimated from the
 * frame size. The last trusted pose is passed to the solver as a warm start;
 * a frame without a face drops it.
 */
export function createHeadPoseTracker(options: HeadPoseTrackerOptions = {}): HeadPoseTracker {
  const horizontalFovDeg = options.horizontalFovDeg ?? DEFAULT_HORIZONTAL_FOV_DEG;
  const maxRmsMm = options.maxRmsReprojectionMm ?? MAX_RMS_REPROJECTION_MM;
  const indices = RIGID_FACE_LANDMARKS.map((landmark) => landmark.landmarkIndex);
  let intrinsics: CameraIntrinsics | null = null;
  let lastTrusted: HeadPose | null = null;

  const intrinsicsFor = (width: number, height: number): CameraIntrinsics | null => {
    if (intrinsics?.width !== width || intrinsics.height !== height) {
      intrinsics = estimateIntrinsics({ width, height, horizontalFovDeg });
    }
    return intrinsics;
  };

  return {
    update(frame) {
      const frameIntrinsics = intrinsicsFor(frame.width, frame.height);
      if (!frameIntrinsics) {
        lastTrusted = null;
        return { trusted: false, reason: 'invalid-frame-size', intrinsics: null, fit: null };
      }
      if (!hasFace(frame)) {
        lastTrusted = null;
        return { trusted: false, reason: 'no-face', intrinsics: frameIntrinsics, fit: null };
      }
      const result = solveHeadPose(
        landmarksToPixels(frame, indices),
        RIGID_FACE_LANDMARKS,
        frameIntrinsics,
        lastTrusted ? { initialPose: lastTrusted } : {},
      );
      const estimate = gateHeadPose(result, frameIntrinsics, maxRmsMm);
      if (estimate.trusted) lastTrusted = estimate.fit.pose;
      return estimate;
    },
    reset() {
      lastTrusted = null;
    },
  };
}
