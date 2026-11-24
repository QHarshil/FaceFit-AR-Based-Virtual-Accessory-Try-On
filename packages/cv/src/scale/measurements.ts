import type { CameraIntrinsics } from '../camera.ts';
import { mat3MulVec3, vec3Add, vec3Norm, vec3Scale, vec3Sub, type Vec2, type Vec3 } from '../linalg.ts';
import type { HeadPose } from '../pnp.ts';
import { castOntoPlane, dot, hasFiniteLandmarks, isValidPose, type FaceScaleEstimate } from './faceScale.ts';
import { canonicalPosition, FACE_WIDTH_LANDMARKS } from './landmarks.ts';

/**
 * Distance from the eye's centre of rotation to its entrance pupil, which is
 * what the iris-centre landmark marks: about 13.5 mm minus 3 mm behind the
 * corneal apex in schematic eyes. Not measured here.
 */
export const PUPIL_TO_ROTATION_CENTRE_MM = 10.5;
/** Spread of that distance across adults, read as one SD; rotation-centre depth varies with axial length. */
export const PUPIL_TO_ROTATION_CENTRE_SD_MM = 1.5;
/**
 * Relative SD of the fixation distance: the iris-implied distance scales
 * with the assumed focal length, and the wearer looks at the screen near the
 * camera, not into the lens.
 */
export const FIXATION_DISTANCE_RELATIVE_SD = 0.2;
/**
 * Relative SD of the focal length when it comes from an assumed field of
 * view: webcams span roughly 55 to 80 degrees horizontal against the 60
 * assumed, about -15% to +10% in focal length.
 */
export const FOCAL_LENGTH_RELATIVE_SD = 0.15;

export type MeasurementFailureReason = 'invalid-pose' | 'missing-landmarks' | 'ray-misses-plane' | 'non-finite';

export interface PupillaryDistanceMeasurement {
  readonly ok: true;
  /** Horizontal distance between the iris centres along the head's x axis while fixating the camera. */
  readonly nearPdMm: number;
  /** Mean distance from the camera to the eyes' centres of rotation, the vergence distance for nearToDistancePd. */
  readonly fixationDistanceMm: number;
}

/**
 * Near pupillary distance from the iris centres in the face-scale estimate,
 * scaled to millimetres, measured along the head's x axis so a turned head
 * does not shorten it.
 */
export function measurePupillaryDistance(
  scale: FaceScaleEstimate,
  pose: HeadPose,
): PupillaryDistanceMeasurement | { readonly ok: false; readonly reason: MeasurementFailureReason } {
  if (!isValidPose(pose)) return { ok: false, reason: 'invalid-pose' };
  const headX: Vec3 = [pose.rotation[0], pose.rotation[3], pose.rotation[6]];
  const backward: Vec3 = [pose.rotation[2], pose.rotation[5], pose.rotation[8]];
  const { right, left } = scale.irisCentresCanonical;
  const nearPdMm = scale.faceScale * Math.abs(dot(vec3Sub(left, right), headX));
  const rotationCentre = (centre: Vec3): Vec3 =>
    vec3Add(vec3Scale(centre, scale.faceScale), vec3Scale(backward, PUPIL_TO_ROTATION_CENTRE_MM));
  const fixationDistanceMm = 0.5 * (vec3Norm(rotationCentre(right)) + vec3Norm(rotationCentre(left)));
  if (!Number.isFinite(nearPdMm) || !Number.isFinite(fixationDistanceMm)) return { ok: false, reason: 'non-finite' };
  return { ok: true, nearPdMm, fixationDistanceMm };
}

export interface DistancePdOptions {
  readonly pupilToRotationCentreMm?: number;
}

export interface DistancePdConversion {
  readonly ok: true;
  readonly distancePdMm: number;
  /** distancePdMm minus the near PD. */
  readonly correctionMm: number;
  /** First-order SD of the correction from the rotation-centre spread and the fixation distance's uncertainty. */
  readonly correctionSdMm: number;
}

/**
 * Converts near PD to distance PD. Each eye turns about its centre of
 * rotation to fixate a point at distance D, which moves the pupil nasally by
 * r sin(a) with sin(a) = (PD / 2) / D, so near PD = PD (1 - r / D) and
 * PD = near PD / (1 - r / D). The convergence model assumes fixation on the
 * camera, symmetric eyes and no phoria. It is a separate step because the
 * near value is what the camera sees.
 */
export function nearToDistancePd(
  nearPdMm: number,
  fixationDistanceMm: number,
  options: DistancePdOptions = {},
): DistancePdConversion | { readonly ok: false; readonly reason: 'invalid-input' } {
  const lever = options.pupilToRotationCentreMm ?? PUPIL_TO_ROTATION_CENTRE_MM;
  const valid = [nearPdMm, fixationDistanceMm, lever].every((value) => Number.isFinite(value) && value > 0);
  // Below ten lever lengths the vergence is beyond what a screen asks for.
  if (!valid || fixationDistanceMm < 10 * lever) return { ok: false, reason: 'invalid-input' };
  const gap = fixationDistanceMm - lever;
  const distancePdMm = (nearPdMm * fixationDistanceMm) / gap;
  const correctionMm = distancePdMm - nearPdMm;
  const perLever = (nearPdMm * fixationDistanceMm) / (gap * gap);
  const perDistance = (-nearPdMm * lever) / (gap * gap);
  const correctionSdMm = Math.hypot(
    perLever * PUPIL_TO_ROTATION_CENTRE_SD_MM,
    perDistance * FIXATION_DISTANCE_RELATIVE_SD * fixationDistanceMm,
  );
  return { ok: true, distancePdMm, correctionMm, correctionSdMm };
}

export interface FaceWidthMeasurement {
  readonly ok: true;
  /** Distance between landmarks 127 and 356 along the head's x axis. */
  readonly faceWidthMm: number;
  /**
   * d ln(width) / d ln(focal length), -(Zw - Ze) / Zw for landmark depth Zw
   * and iris depth Ze. The landmarks sit about 6 cm behind the irises, and
   * the depth ratio that converts their image width depends on the absolute
   * distance, which scales with the focal length.
   */
  readonly focalElasticity: number;
}

const FACE_WIDTH_POINTS_MODEL = FACE_WIDTH_LANDMARKS.map(canonicalPosition) as [Vec3, Vec3];

/**
 * Face width at eye level. Each landmark's ray is cast onto the plane
 * through its canonical position facing along the head's forward axis, so a
 * turned head's near and far sides are measured at their own depths. The
 * result scales with faceScale. These are silhouette landmarks: on a turned
 * head they slide along the face, so only near-frontal frames give a stable
 * value.
 */
export function measureFaceWidth(
  landmarksPx: readonly Vec2[],
  pose: HeadPose,
  intrinsics: CameraIntrinsics,
  scale: FaceScaleEstimate,
): FaceWidthMeasurement | { readonly ok: false; readonly reason: MeasurementFailureReason } {
  if (!isValidPose(pose)) return { ok: false, reason: 'invalid-pose' };
  if (!hasFiniteLandmarks(landmarksPx, FACE_WIDTH_LANDMARKS)) return { ok: false, reason: 'missing-landmarks' };
  const headX: Vec3 = [pose.rotation[0], pose.rotation[3], pose.rotation[6]];
  const depthAxis: Vec3 = [pose.rotation[2], pose.rotation[5], pose.rotation[8]];
  const points = FACE_WIDTH_POINTS_MODEL.map((model) => vec3Add(mat3MulVec3(pose.rotation, model), pose.translationMm));
  const hits = FACE_WIDTH_LANDMARKS.map((index, k) => castOntoPlane(landmarksPx[index]!, intrinsics, points[k]!, depthAxis));
  if (!hits[0] || !hits[1]) return { ok: false, reason: 'ray-misses-plane' };
  const faceWidthMm = scale.faceScale * Math.abs(dot(vec3Sub(hits[1], hits[0]), headX));
  const widthDepth = 0.5 * (points[0]![2] + points[1]![2]);
  const focalElasticity = -(widthDepth - scale.pnpDepthMm) / widthDepth;
  return Number.isFinite(faceWidthMm) && Number.isFinite(focalElasticity)
    ? { ok: true, faceWidthMm, focalElasticity }
    : { ok: false, reason: 'non-finite' };
}
