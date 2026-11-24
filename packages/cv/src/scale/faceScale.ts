import { isValidIntrinsics, projectPoint, type CameraIntrinsics } from '../camera.ts';
import { mat3MulVec3, vec3Add, vec3Norm, vec3Scale, vec3Sub, type Vec2, type Vec3 } from '../linalg.ts';
import type { HeadPose } from '../pnp.ts';
import { isRotationMatrix } from '../rotation.ts';
import { fitIris, type IrisFitOptions } from './iris.ts';
import { canonicalPosition, EYE_LANDMARKS, EYES, FACE_MESH_IRIS_LANDMARK_COUNT, type Eye } from './landmarks.ts';

/**
 * Horizontal visible iris diameter: Google's 11.7 +- 0.5 mm, read here as
 * mean and SD. Clinical series agree (Tehran, n = 410: mean 11.68 mm, 95%
 * range 10.76 to 12.60).
 */
export const POPULATION_IRIS_DIAMETER_MM = { mean: 11.7, sd: 0.5 } as const;

/**
 * The visible iris lies in front of the eye corners: the corners sit roughly
 * 8 to 10 mm behind the corneal apex and the iris seen through the cornea
 * about 3 mm behind it. A heuristic from typical anatomy, not a fit. PD does
 * not depend on it to first order; face width and depth shift by about
 * offset error over distance.
 */
export const IRIS_PLANE_OFFSET_MM = 6;
/** Spread of that offset across faces, read as one SD. */
export const IRIS_PLANE_OFFSET_SD_MM = 3;

/**
 * Largest relative difference between the two irises' horizontal diameters
 * that counts as the same iris. Real left and right irises differ little,
 * and on the recordings the frame ratio's 1st to 99th percentiles stay
 * within this (irisDiameterRatio in eval/results.json). A single eye off by
 * more is a landmark fault; below it, a faulty eye moves the mean diameter,
 * and PD, by at most half of it.
 */
export const IRIS_ASYMMETRY_TOLERANCE = 0.06;

export interface FaceScaleOptions extends IrisFitOptions {
  /** Assumed horizontal iris diameter; defaults to the population mean. */
  readonly irisDiameterMm?: number;
}

export interface FaceScaleEstimate {
  readonly ok: true;
  /**
   * The wearer's size over the canonical model's: the assumed iris diameter
   * over the iris diameter back-projected at the pose's canonical scale.
   * Equal to irisDepthMm / pnpDepthMm.
   */
  readonly faceScale: number;
  /** Horizontal iris diameter at canonical scale, the mean over eyesUsed. */
  readonly canonicalIrisDiameterMm: number;
  /** Depth of the point between the irises implied by the assumed iris size. Scales with the focal length. */
  readonly irisDepthMm: number;
  /** Depth of the same point from the pose, which assumes the canonical model's size. */
  readonly pnpDepthMm: number;
  /** Size of one pixel at irisDepthMm, for a surface facing the camera. */
  readonly mmPerPixel: number;
  /** Eyes whose horizontal diameter entered faceScale. */
  readonly eyesUsed: readonly Eye[];
  /** Right over left horizontal diameter at canonical scale; null unless both eyes entered faceScale. */
  readonly irisDiameterRatio: number | null;
  /** Fitted iris centres in camera coordinates at canonical scale; multiply by faceScale for millimetres. */
  readonly irisCentresCanonical: Readonly<Record<Eye, Vec3>>;
  /** Where each iris plane is assumed to cross the eye, camera coordinates at canonical scale. */
  readonly eyePointsCanonical: Readonly<Record<Eye, Vec3>>;
}

export type FaceScaleFailureReason =
  | 'missing-landmarks'
  | 'invalid-intrinsics'
  | 'invalid-pose'
  | 'invalid-options'
  | 'ray-misses-plane'
  | 'iris-fit-failed'
  | 'inconsistent-iris'
  | 'iris-outside-eye';

export type FaceScaleResult = FaceScaleEstimate | { readonly ok: false; readonly reason: FaceScaleFailureReason };

/** Model-frame point each iris plane passes through: between the eye corners, moved toward the camera. */
function eyePointModel(eye: Eye): Vec3 {
  const [a, b] = EYE_LANDMARKS[eye].corners.map(canonicalPosition) as [Vec3, Vec3];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 - IRIS_PLANE_OFFSET_MM];
}

const EYE_POINTS_MODEL: Readonly<Record<Eye, Vec3>> = { right: eyePointModel('right'), left: eyePointModel('left') };

/**
 * Metric scale from the iris. Each eye's five iris landmarks are cast as rays
 * onto that eye's iris plane at the pose's canonical scale, and fitIris
 * measures the horizontal diameter there. The plane passes through the eye
 * point and faces the camera: the wearer is assumed to fixate the camera,
 * which near-PD conversion assumes too. Its horizontal axis is the head's x
 * axis projected onto it, so roll and the perspective of an off-centre face
 * are removed. If the eyes follow the head instead of the camera, the iris
 * turns away by the angle between the head's forward axis and the line of
 * sight, its diameter reads cos of that angle too small, and PD and face
 * width read 1 / cos too large; aggregateFaceMeasurements accepts frames
 * where the angle is small.
 */
export function estimateFaceScale(
  landmarksPx: readonly Vec2[],
  pose: HeadPose,
  intrinsics: CameraIntrinsics,
  options: FaceScaleOptions = {},
): FaceScaleResult {
  const irisDiameterMm = options.irisDiameterMm ?? POPULATION_IRIS_DIAMETER_MM.mean;
  if (!(irisDiameterMm > 0 && Number.isFinite(irisDiameterMm))) return { ok: false, reason: 'invalid-options' };
  if (!isValidIntrinsics(intrinsics)) return { ok: false, reason: 'invalid-intrinsics' };
  if (!isValidPose(pose)) return { ok: false, reason: 'invalid-pose' };
  if (!hasFiniteLandmarks(landmarksPx, IRIS_LANDMARK_INDICES)) return { ok: false, reason: 'missing-landmarks' };

  const headX: Vec3 = [pose.rotation[0], pose.rotation[3], pose.rotation[6]];
  const horizontal = {} as Record<Eye, { readonly diameter: number; readonly offset: number; readonly tolerance: number } | null>;
  const irisCentres = {} as Record<Eye, Vec3>;
  const eyePoints = {} as Record<Eye, Vec3>;
  for (const eye of EYES) {
    const indices = EYE_LANDMARKS[eye];
    const eyePoint = vec3Add(mat3MulVec3(pose.rotation, EYE_POINTS_MODEL[eye]), pose.translationMm);
    const normal = vec3Scale(eyePoint, -1 / vec3Norm(eyePoint));
    const axisU = normalize(vec3Sub(headX, vec3Scale(normal, dot(headX, normal))));
    if (!axisU) return { ok: false, reason: 'invalid-pose' };
    const axisV = cross(axisU, normal);
    const onPlane = (index: number): Vec2 | null => {
      const hit = castOntoPlane(landmarksPx[index]!, intrinsics, eyePoint, normal);
      if (!hit) return null;
      const offset = vec3Sub(hit, eyePoint);
      return [dot(offset, axisU), dot(offset, axisV)];
    };
    const centre = onPlane(indices.irisCentre);
    const pair = indices.irisHorizontal.map(onPlane);
    const vertical = indices.irisVertical.map(onPlane);
    if (!centre || pair.includes(null) || vertical.includes(null)) return { ok: false, reason: 'ray-misses-plane' };
    const fit = fitIris(
      { centre, horizontal: [pair[0]!, pair[1]!], vertical: [vertical[0]!, vertical[1]!] },
      { unitsPerPixel: vec3Norm(eyePoint) / intrinsics.fx },
      options,
    );
    if (!fit.ok) return { ok: false, reason: 'iris-fit-failed' };
    irisCentres[eye] = vec3Add(eyePoint, vec3Add(vec3Scale(axisU, fit.centre[0]), vec3Scale(axisV, fit.centre[1])));
    const centrePx = projectPoint(intrinsics, irisCentres[eye]);
    if (!centrePx || !irisInsideEye(landmarksPx, eye, centrePx)) return { ok: false, reason: 'iris-outside-eye' };
    eyePoints[eye] = eyePoint;
    horizontal[eye] =
      fit.horizontalDiameter === null ? null : { diameter: fit.horizontalDiameter, offset: fit.horizontalOffset, tolerance: fit.tolerance };
  }
  const eyesUsed = EYES.filter((eye) => horizontal[eye] !== null);
  if (eyesUsed.length === 2) {
    const dropped = displacedHorizontalPoint(horizontal.right!, horizontal.left!);
    if (dropped) eyesUsed.splice(eyesUsed.indexOf(dropped), 1);
  }
  if (!eyesUsed.length) return { ok: false, reason: 'inconsistent-iris' };

  const diameters = eyesUsed.map((eye) => horizontal[eye]!.diameter);
  const canonicalIrisDiameterMm = diameters.reduce((sum, value) => sum + value, 0) / diameters.length;
  const faceScale = irisDiameterMm / canonicalIrisDiameterMm;
  const pnpDepthMm = 0.5 * (eyePoints.right[2] + eyePoints.left[2]);
  const estimate: FaceScaleEstimate = {
    ok: true,
    faceScale,
    canonicalIrisDiameterMm,
    irisDepthMm: faceScale * pnpDepthMm,
    pnpDepthMm,
    mmPerPixel: (faceScale * pnpDepthMm) / intrinsics.fx,
    eyesUsed,
    irisDiameterRatio: eyesUsed.length === 2 ? horizontal.right!.diameter / horizontal.left!.diameter : null,
    irisCentresCanonical: irisCentres,
    eyePointsCanonical: eyePoints,
  };
  const finite = [faceScale, estimate.irisDepthMm, estimate.mmPerPixel, ...irisCentres.right, ...irisCentres.left].every(Number.isFinite);
  return finite && faceScale > 0 ? estimate : { ok: false, reason: 'ray-misses-plane' };
}

/**
 * The eye to leave out when the two diameters disagree by more than
 * IRIS_ASYMMETRY_TOLERANCE because of one displaced horizontal point. Such a
 * point moves its pair's midpoint off the median centre by half the error
 * it adds to the diameter, so the suspect is the eye whose midpoint is
 * further off. It is left out only when the disagreement exceeds its fit
 * tolerance and the offset half of it, so landmark noise up to the
 * tolerance's floor rarely triggers it, and when the offset accounts for at
 * least half the disagreement. A contour shrunk or grown about its centre keeps
 * its midpoint and stays in, for the aggregator's asymmetry gate.
 */
function displacedHorizontalPoint(
  right: { readonly diameter: number; readonly offset: number; readonly tolerance: number },
  left: { readonly diameter: number; readonly offset: number; readonly tolerance: number },
): Eye | null {
  if (Math.abs(Math.log(right.diameter / left.diameter)) <= Math.log(1 + IRIS_ASYMMETRY_TOLERANCE)) return null;
  const [eye, suspect] = Math.abs(right.offset) >= Math.abs(left.offset) ? (['right', right] as const) : (['left', left] as const);
  const offset = Math.abs(suspect.offset);
  const disagreement = Math.abs(right.diameter - left.diameter);
  return disagreement > suspect.tolerance && offset > suspect.tolerance / 2 && offset >= disagreement / 4 ? eye : null;
}

const IRIS_LANDMARK_INDICES: readonly number[] = EYES.flatMap((eye) => {
  const indices = EYE_LANDMARKS[eye];
  return [indices.irisCentre, ...indices.irisHorizontal, ...indices.irisVertical, ...indices.corners, indices.upperLid, indices.lowerLid];
});

/**
 * True when the fitted iris centre lies in the eye: inside the ellipse
 * through the two corners whose half-height on each side of the corner line
 * reaches that side's lid, or one iris radius when the lid is nearer. The
 * radius floor keeps a closing eye, whose lids meet near the line, for the
 * openness gate to judge. Iris landmarks that belong to a different place
 * in the image fail this, whatever scale they imply.
 */
function irisInsideEye(landmarksPx: readonly Vec2[], eye: Eye, centrePx: Vec2): boolean {
  const indices = EYE_LANDMARKS[eye];
  const [a, b] = indices.corners.map((index) => landmarksPx[index]!) as [Vec2, Vec2];
  const halfLength = 0.5 * Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(halfLength > 0)) return false;
  const along: Vec2 = [(b[0] - a[0]) / (2 * halfLength), (b[1] - a[1]) / (2 * halfLength)];
  const middle: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const toAxis = (p: Vec2): Vec2 => {
    const dx = p[0] - middle[0];
    const dy = p[1] - middle[1];
    return [dx * along[0] + dy * along[1], -dx * along[1] + dy * along[0]];
  };
  const [u, v] = toAxis(centrePx);
  const [h0, h1] = indices.irisHorizontal.map((index) => landmarksPx[index]!) as [Vec2, Vec2];
  const radiusPx = 0.5 * Math.abs(toAxis(h1)[0] - toAxis(h0)[0]);
  const lidOffsets = [toAxis(landmarksPx[indices.upperLid]!)[1], toAxis(landmarksPx[indices.lowerLid]!)[1]];
  const sameSide = lidOffsets.filter((offset) => Math.sign(offset) === Math.sign(v)).map(Math.abs);
  const halfHeight = Math.max(radiusPx, ...sameSide);
  return (u / halfLength) ** 2 + (v / halfHeight) ** 2 <= 1;
}

/** True when landmarksPx has the full Face Mesh length and finite pixels at the given indices. */
export function hasFiniteLandmarks(landmarksPx: readonly Vec2[], indices: readonly number[]): boolean {
  if (!Array.isArray(landmarksPx) || landmarksPx.length < FACE_MESH_IRIS_LANDMARK_COUNT) return false;
  return indices.every((index) => {
    const pixel = landmarksPx[index];
    return Array.isArray(pixel) && Number.isFinite(pixel[0]) && Number.isFinite(pixel[1]);
  });
}

/** Intersection of the pixel's viewing ray with the plane through point with the given normal; null behind the camera or parallel. */
export function castOntoPlane(pixel: Vec2, intrinsics: CameraIntrinsics, point: Vec3, normal: Vec3): Vec3 | null {
  const ray: Vec3 = [(pixel[0] - intrinsics.cx) / intrinsics.fx, (pixel[1] - intrinsics.cy) / intrinsics.fy, 1];
  const along = dot(normal, ray);
  // A ray within about 0.06 degrees of the plane meets it too far out to mean anything.
  if (!(Math.abs(along) > 1e-3 * vec3Norm(ray))) return null;
  const distance = dot(normal, point) / along;
  return distance > 0 ? vec3Scale(ray, distance) : null;
}

export function isValidPose(pose: HeadPose): boolean {
  return (
    !!pose &&
    Array.isArray(pose.rotation) &&
    Array.isArray(pose.translationMm) &&
    isRotationMatrix(pose.rotation, 1e-6) &&
    pose.translationMm.length === 3 &&
    pose.translationMm.every(Number.isFinite) &&
    pose.translationMm[2] > 0
  );
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3): Vec3 | null {
  const length = vec3Norm(v);
  return length > 1e-9 ? vec3Scale(v, 1 / length) : null;
}
