import {
  estimateIntrinsics,
  RIGID_FACE_LANDMARKS,
  solveHeadPose,
  type CameraIntrinsics,
  type HeadPose,
  type HeadPoseFailureReason,
  type HeadPoseResult,
  type Mat3,
  type Vec2,
  type Vec3,
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
 * Reprojection RMS, in millimetres at the face's depth, above which a shown
 * overlay hides. The RMS in pixels grows with the face's size in the image,
 * from landmark noise and from the gap between the wearer's face and the
 * canonical one. Dividing by the image scale (focal length over depth) removes
 * the face's size from that gap, but not from pixel noise: for a fixed noise
 * in pixels the RMS in millimetres still grows in proportion to depth, so a far
 * face gates sooner than a near one. The harness measures at most 3.58 mm for
 * a still face and 4.53 mm through blinks (`summary.solver` in
 * eval/results.json), so a blink does not hide the frame.
 */
export const MAX_RMS_REPROJECTION_MM = 6;

/**
 * RMS below which a hidden overlay shows again. It sits just above the
 * largest blink reading, so a face that blinks normally is shown again at
 * once, and a reading that wanders between this value and the hide value
 * does not flip the overlay every frame.
 */
export const SHOW_BELOW_RMS_MM = 5;

export type GateReason =
  'no-face' | 'invalid-frame-size' | HeadPoseFailureReason | 'reprojection' | 'facing-away';

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
      /** Present when the solve succeeded and a gate rejected it. */
      readonly fit: HeadPoseFit | null;
    };

/** Normalized landmarks to pixels of the frame they were detected in. */
export function landmarksToPixels(frame: LandmarkFrame, indices: readonly number[]): Vec2[] {
  return indices.map((index) => {
    const { x, y } = landmarkPoint(frame, index);
    return [x * frame.width, y * frame.height];
  });
}

export interface GateOptions {
  /** Hide above this RMS when the overlay was shown. */
  readonly maxRmsMm?: number;
  /** Show again only below this RMS when the overlay was hidden. */
  readonly showBelowRmsMm?: number;
  /** Whether the previous frame was trusted. A first frame counts as shown. */
  readonly wasShown?: boolean;
}

/**
 * The face's forward axis (model -z) points at the camera when it has a
 * positive component along the line from the face to the camera. A mirrored
 * landmark set fits the model with a flipped depth, so it fails this while
 * its reprojection error stays small.
 */
const facesCamera = (rotation: Mat3, translationMm: Vec3): boolean =>
  rotation[2] * translationMm[0] + rotation[5] * translationMm[1] + rotation[8] * translationMm[2] >
  0;

/**
 * Trusts a solve that succeeded, faces the camera, and has a reprojection RMS
 * at most `maxRmsMm`, or below `showBelowRmsMm` when the last frame was hidden.
 */
export function gateHeadPose(
  result: HeadPoseResult,
  intrinsics: CameraIntrinsics,
  options: GateOptions = {},
): HeadPoseEstimate {
  const maxRmsMm = options.maxRmsMm ?? MAX_RMS_REPROJECTION_MM;
  const showBelowRmsMm = Math.min(options.showBelowRmsMm ?? SHOW_BELOW_RMS_MM, maxRmsMm);
  if (!result.ok) return { trusted: false, reason: result.reason, intrinsics, fit: null };
  const fit: HeadPoseFit = {
    pose: { rotation: result.rotation, translationMm: result.translationMm },
    rmsReprojectionPx: result.rmsReprojectionPx,
    rmsReprojectionMm: (result.rmsReprojectionPx * result.translationMm[2]) / intrinsics.fx,
    inlierCount: result.inlierIndices.length,
  };
  if (!facesCamera(result.rotation, result.translationMm)) {
    return { trusted: false, reason: 'facing-away', intrinsics, fit };
  }
  const withinGate =
    options.wasShown === false
      ? fit.rmsReprojectionMm < showBelowRmsMm
      : fit.rmsReprojectionMm <= maxRmsMm;
  if (!withinGate) return { trusted: false, reason: 'reprojection', intrinsics, fit };
  return { trusted: true, intrinsics, fit };
}

export interface HeadPoseTrackerOptions {
  readonly horizontalFovDeg?: number;
  readonly maxRmsReprojectionMm?: number;
  readonly showBelowRmsMm?: number;
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
  const showBelowRmsMm = options.showBelowRmsMm ?? SHOW_BELOW_RMS_MM;
  const indices = RIGID_FACE_LANDMARKS.map((landmark) => landmark.landmarkIndex);
  let intrinsics: CameraIntrinsics | null = null;
  let lastTrusted: HeadPose | null = null;
  let wasShown = true;

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
        wasShown = true;
        return { trusted: false, reason: 'no-face', intrinsics: frameIntrinsics, fit: null };
      }
      const result = solveHeadPose(
        landmarksToPixels(frame, indices),
        RIGID_FACE_LANDMARKS,
        frameIntrinsics,
        lastTrusted ? { initialPose: lastTrusted } : {},
      );
      const estimate = gateHeadPose(result, frameIntrinsics, {
        maxRmsMm,
        showBelowRmsMm,
        wasShown,
      });
      wasShown = estimate.trusted;
      if (estimate.trusted) lastTrusted = estimate.fit.pose;
      return estimate;
    },
    reset() {
      lastTrusted = null;
      wasShown = true;
    },
  };
}
