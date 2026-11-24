import type { CameraIntrinsics } from '../camera.ts';
import { mat3MulVec3, mat3Transpose, vec3Norm, vec3Scale, type Vec2, type Vec3 } from '../linalg.ts';
import type { HeadPoseResult } from '../pnp.ts';
import { estimateFaceScale, hasFiniteLandmarks, IRIS_PLANE_OFFSET_SD_MM, type FaceScaleOptions } from './faceScale.ts';
import { EYE_LANDMARKS, EYES } from './landmarks.ts';
import {
  FOCAL_LENGTH_RELATIVE_SD,
  measureFaceWidth,
  measurePupillaryDistance,
  nearToDistancePd,
  type DistancePdOptions,
} from './measurements.ts';

export interface FaceFrameOptions extends FaceScaleOptions, DistancePdOptions {
  /** Relative SD of the focal length; lower it once the camera is calibrated. */
  readonly focalLengthRelativeSd?: number;
}

/** Everything the aggregator needs from one frame. */
export interface FaceFrame {
  readonly ok: true;
  /**
   * Direction from the eyes to the camera in head coordinates, as horizontal
   * and vertical angles; both 0 when the face points straight at the camera.
   * Yaw is positive toward the wearer's left, pitch toward the chin.
   */
  readonly lineOfSightYawDeg: number;
  readonly lineOfSightPitchDeg: number;
  /** Lid gap over corner-to-corner width, the smaller of the two eyes. */
  readonly eyeOpenness: number;
  /** Reprojection RMS times depth over focal length, as the app gates the overlay. */
  readonly rmsReprojectionMm: number;
  /** Largest rotation SD over the three axes; null when the solve reported none. */
  readonly maxRotationStdDeg: number | null;
  readonly faceScale: number;
  /** Right over left horizontal iris diameter, null when only one eye set the scale. */
  readonly irisDiameterRatio: number | null;
  readonly irisDepthMm: number;
  readonly nearPdMm: number;
  readonly distancePdMm: number;
  readonly distancePdCorrectionSdMm: number;
  readonly faceWidthMm: number;
  /**
   * SD of face width from the assumptions behind it: the focal length,
   * through focalElasticity, and the iris plane's offset, which shifts the
   * width by offset error over iris depth.
   */
  readonly faceWidthModelSdMm: number;
}

export type FaceFrameFailureReason = 'no-face' | 'pose-failed' | 'missing-landmarks' | 'iris-outside-eye' | 'measurement-failed';

export type FaceFrameResult = FaceFrame | { readonly ok: false; readonly reason: FaceFrameFailureReason };

const EYELID_INDICES = EYES.flatMap((eye) => {
  const indices = EYE_LANDMARKS[eye];
  return [indices.upperLid, indices.lowerLid, ...indices.corners];
});
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Measures one frame: face scale from the iris, near and distance PD, face
 * width, and the signals the aggregator gates on. landmarksPx is null when no
 * face was found; pose is the solveHeadPose result for the same frame.
 */
export function measureFaceFrame(
  landmarksPx: readonly Vec2[] | null,
  pose: HeadPoseResult | null,
  intrinsics: CameraIntrinsics,
  options: FaceFrameOptions = {},
): FaceFrameResult {
  const focalLengthRelativeSd = options.focalLengthRelativeSd ?? FOCAL_LENGTH_RELATIVE_SD;
  if (!landmarksPx) return { ok: false, reason: 'no-face' };
  if (!pose || !pose.ok) return { ok: false, reason: 'pose-failed' };
  if (!hasFiniteLandmarks(landmarksPx, EYELID_INDICES)) return { ok: false, reason: 'missing-landmarks' };

  const scale = estimateFaceScale(landmarksPx, pose, intrinsics, options);
  if (!scale.ok) {
    const passed = scale.reason === 'missing-landmarks' || scale.reason === 'iris-outside-eye';
    return { ok: false, reason: passed ? scale.reason : 'measurement-failed' };
  }
  const pd = measurePupillaryDistance(scale, pose);
  const width = measureFaceWidth(landmarksPx, pose, intrinsics, scale);
  if (!width.ok && width.reason === 'missing-landmarks') return { ok: false, reason: 'missing-landmarks' };
  if (!pd.ok || !width.ok) return { ok: false, reason: 'measurement-failed' };
  const distance = nearToDistancePd(pd.nearPdMm, pd.fixationDistanceMm, options);
  if (!distance.ok) return { ok: false, reason: 'measurement-failed' };

  const { right, left } = scale.eyePointsCanonical;
  const between: Vec3 = [(right[0] + left[0]) / 2, (right[1] + left[1]) / 2, (right[2] + left[2]) / 2];
  const towardCamera = mat3MulVec3(mat3Transpose(pose.rotation), vec3Scale(between, -1 / vec3Norm(between)));
  const openness = EYES.map((eye) => {
    const indices = EYE_LANDMARKS[eye];
    const gap = distancePx(landmarksPx[indices.upperLid]!, landmarksPx[indices.lowerLid]!);
    return gap / distancePx(landmarksPx[indices.corners[0]]!, landmarksPx[indices.corners[1]]!);
  });
  const rotationStd = pose.uncertainty?.rotationStdDeg;
  const frame: FaceFrame = {
    ok: true,
    lineOfSightYawDeg: Math.atan2(towardCamera[0], -towardCamera[2]) * RAD_TO_DEG,
    lineOfSightPitchDeg: Math.atan2(towardCamera[1], -towardCamera[2]) * RAD_TO_DEG,
    eyeOpenness: Math.min(...openness),
    rmsReprojectionMm: (pose.rmsReprojectionPx * pose.translationMm[2]) / intrinsics.fx,
    maxRotationStdDeg: rotationStd ? Math.max(...rotationStd) : null,
    faceScale: scale.faceScale,
    irisDiameterRatio: scale.irisDiameterRatio,
    irisDepthMm: scale.irisDepthMm,
    nearPdMm: pd.nearPdMm,
    distancePdMm: distance.distancePdMm,
    distancePdCorrectionSdMm: distance.correctionSdMm,
    faceWidthMm: width.faceWidthMm,
    faceWidthModelSdMm:
      width.faceWidthMm *
      Math.hypot(width.focalElasticity * focalLengthRelativeSd, IRIS_PLANE_OFFSET_SD_MM / scale.irisDepthMm),
  };
  const numbers = Object.values(frame).filter((value): value is number => typeof value === 'number');
  return numbers.every(Number.isFinite) ? frame : { ok: false, reason: 'measurement-failed' };
}

function distancePx(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
