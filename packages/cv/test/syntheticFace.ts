import { projectPoint, type CameraIntrinsics } from '../src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import { mat3MulVec3, mat3Transpose, vec3Add, vec3Norm, vec3Scale, vec3Sub, type Vec2, type Vec3 } from '../src/linalg.ts';
import type { HeadPose } from '../src/pnp.ts';
import { IRIS_PLANE_OFFSET_MM } from '../src/scale/faceScale.ts';
import { canonicalPosition, EYE_LANDMARKS, EYES, FACE_MESH_IRIS_LANDMARK_COUNT, FACE_WIDTH_LANDMARKS, type Eye } from '../src/scale/landmarks.ts';
import type { SeededRandom } from './random.ts';

/** A synthetic wearer in millimetres. */
export interface SyntheticSubject {
  /** Rigid landmarks are the canonical model scaled by this. */
  readonly faceScale: number;
  readonly irisDiameterMm: number;
  /** Vertical over horizontal iris contour; below 1 on MediaPipe output (irisVerticalOverHorizontal in eval/results.json). */
  readonly irisAspect: number;
  /** Separation of the eyes' centres of rotation. */
  readonly distancePdMm: number;
  readonly pupilToRotationCentreMm: number;
  /** How far the real iris plane sits in front of the plane the estimator assumes. */
  readonly irisPlaneShiftMm: number;
}

export const AVERAGE_SUBJECT: SyntheticSubject = {
  faceScale: 1,
  irisDiameterMm: 11.7,
  irisAspect: 0.87,
  distancePdMm: 63,
  pupilToRotationCentreMm: 10.5,
  irisPlaneShiftMm: 0,
};

export interface SyntheticFrameOptions {
  /** 'camera': each eye turns to the camera. 'head': both look along the head's forward axis. */
  readonly gaze?: 'camera' | 'head';
  /** Lid gap over eye width, 0.32 by default. */
  readonly eyeOpenness?: number;
  /** Fraction the iris contour shrinks by, as MediaPipe's does while the lids close. */
  readonly irisShrink?: number;
}

export interface SyntheticFrame {
  /** 478 Face Mesh landmarks in pixels; landmarks the scale code does not read are NaN. */
  readonly landmarksPx: Vec2[];
  readonly truth: {
    /** Horizontal separation of the pupils along the head's x axis, as rendered. */
    readonly nearPdMm: number;
    readonly distancePdMm: number;
    /** Landmarks 127 to 356 along the head's x axis. */
    readonly faceWidthMm: number;
    /** Depth of the point the estimator places between the irises, in millimetres. */
    readonly eyeDepthMm: number;
  };
}

function eyeCentreModel(eye: Eye, subject: SyntheticSubject): Vec3 {
  const [a, b] = EYE_LANDMARKS[eye].corners.map(canonicalPosition) as [Vec3, Vec3];
  const s = subject.faceScale;
  return [((a[0] + b[0]) / 2) * s, ((a[1] + b[1]) / 2) * s, ((a[2] + b[2]) / 2 - IRIS_PLANE_OFFSET_MM) * s];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(v: Vec3): Vec3 {
  return vec3Scale(v, 1 / vec3Norm(v));
}

/**
 * Renders the landmarks the scale code reads. The pose maps the subject's
 * model (millimetres, canonical axes) to the camera. Each eye's centre of
 * rotation sits at x = +-distancePd / 2, at the canonical eye height, and
 * pupilToRotationCentre behind the iris plane; the pupil is that far along
 * the gaze from it. The iris contour is an ellipse in the plane facing the
 * gaze, its horizontal axis the head's x axis projected onto that plane.
 */
export function renderSyntheticFace(
  subject: SyntheticSubject,
  pose: HeadPose,
  intrinsics: CameraIntrinsics,
  sigmaPx: number,
  random: SeededRandom,
  options: SyntheticFrameOptions = {},
): SyntheticFrame {
  const gaze = options.gaze ?? 'camera';
  const openness = options.eyeOpenness ?? 0.32;
  const irisDiameter = subject.irisDiameterMm * (1 - (options.irisShrink ?? 0));
  const s = subject.faceScale;
  const landmarksPx: Vec2[] = Array.from({ length: FACE_MESH_IRIS_LANDMARK_COUNT }, () => [Number.NaN, Number.NaN]);
  const toPixel = (model: Vec3): Vec2 => {
    const pixel = projectPoint(intrinsics, vec3Add(mat3MulVec3(pose.rotation, model), pose.translationMm));
    if (!pixel) throw new Error('synthetic face point behind the camera');
    return [pixel[0] + random.gaussian(sigmaPx), pixel[1] + random.gaussian(sigmaPx)];
  };
  for (const landmark of RIGID_FACE_LANDMARKS) landmarksPx[landmark.landmarkIndex] = toPixel(vec3Scale(landmark.positionMm, s));

  const cameraInModel = mat3MulVec3(mat3Transpose(pose.rotation), vec3Scale(pose.translationMm, -1));
  const pupils = {} as Record<Eye, Vec3>;
  for (const eye of EYES) {
    const indices = EYE_LANDMARKS[eye];
    const eyePoint = eyeCentreModel(eye, subject);
    const side = eye === 'right' ? -1 : 1;
    const rotationCentre: Vec3 = [
      (side * subject.distancePdMm) / 2,
      eyePoint[1],
      eyePoint[2] - subject.irisPlaneShiftMm + subject.pupilToRotationCentreMm,
    ];
    const gazeDirection = gaze === 'camera' ? unit(vec3Sub(cameraInModel, rotationCentre)) : ([0, 0, -1] as Vec3);
    const pupil = vec3Add(rotationCentre, vec3Scale(gazeDirection, subject.pupilToRotationCentreMm));
    pupils[eye] = pupil;
    const horizontal = unit(vec3Sub([1, 0, 0], vec3Scale(gazeDirection, gazeDirection[0])));
    const vertical = cross(horizontal, gazeDirection);
    const halfWidth = irisDiameter / 2;
    const halfHeight = (irisDiameter * subject.irisAspect) / 2;
    landmarksPx[indices.irisCentre] = toPixel(pupil);
    landmarksPx[indices.irisHorizontal[0]] = toPixel(vec3Add(pupil, vec3Scale(horizontal, halfWidth)));
    landmarksPx[indices.irisHorizontal[1]] = toPixel(vec3Sub(pupil, vec3Scale(horizontal, halfWidth)));
    landmarksPx[indices.irisVertical[0]] = toPixel(vec3Sub(pupil, vec3Scale(vertical, halfHeight)));
    landmarksPx[indices.irisVertical[1]] = toPixel(vec3Add(pupil, vec3Scale(vertical, halfHeight)));

    const [cornerA, cornerB] = indices.corners.map((index) => vec3Scale(canonicalPosition(index), s)) as [Vec3, Vec3];
    const lidGap = openness * vec3Norm(vec3Sub(cornerB, cornerA));
    const lidBase: Vec3 = [eyePoint[0], eyePoint[1], eyePoint[2] + IRIS_PLANE_OFFSET_MM * s];
    landmarksPx[indices.upperLid] = toPixel(vec3Add(lidBase, [0, -lidGap / 2, 0]));
    landmarksPx[indices.lowerLid] = toPixel(vec3Add(lidBase, [0, lidGap / 2, 0]));
  }

  const [widthA, widthB] = FACE_WIDTH_LANDMARKS.map((index) => canonicalPosition(index)[0] * s) as [number, number];
  const between = vec3Scale(vec3Add(eyeCentreModel('right', subject), eyeCentreModel('left', subject)), 0.5);
  return {
    landmarksPx,
    truth: {
      nearPdMm: Math.abs(pupils.left[0] - pupils.right[0]),
      distancePdMm: subject.distancePdMm,
      faceWidthMm: Math.abs(widthB - widthA),
      eyeDepthMm: vec3Add(mat3MulVec3(pose.rotation, between), pose.translationMm)[2],
    },
  };
}
