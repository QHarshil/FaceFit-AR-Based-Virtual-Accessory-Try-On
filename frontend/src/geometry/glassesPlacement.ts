import { mat3Multiply, mat3MulVec3, type HeadPose, type Mat3, type Vec3 } from '@facefit/cv';

/**
 * Face Mesh landmark the frame's bridge rests on: the midline point between
 * the eyes. The catalog models put the bridge 11 to 13 mm above the middle of
 * the frame front, so seating it here leaves the eyes in the upper half of
 * the lenses. Landmark 6, the next point down the nose and part of the rigid
 * set, sits at eye level and would put the eyes near the top rim.
 */
export const NOSE_BRIDGE_LANDMARK = 168;

/**
 * Landmark 168 in the solver's face model frame (mm; x right, y down, z away
 * from the camera for a frontal face): vertex 168 of MediaPipe's
 * canonical_face_model.obj, the file pinned in
 * packages/cv/scripts/convert_canonical_face_model.py, converted to
 * millimetres with y and z negated like RIGID_FACE_LANDMARKS.
 */
export const CANONICAL_NOSE_BRIDGE_MM: Vec3 = [0, -32.71027, -52.36015];

/**
 * Gap between the skin at landmark 168 and the rear face of the bridge bar,
 * toward the viewer. A heuristic: the nose ridge rises about 2 mm in front of
 * landmark 168 within the few millimetres below it that a bridge bar covers
 * (canonical landmarks 168 and 6), and 1 mm more keeps the bar off the skin.
 */
export const BRIDGE_FORWARD_OFFSET_MM = 3;

/** Maps a point p to rotation * p + translationMm. */
export interface RigidTransform {
  readonly rotation: Mat3;
  readonly translationMm: Vec3;
}

/**
 * The glasses model frame (x toward the wearer's left, y up, z toward the
 * viewer) and the renderer's eye space (x right, y up, z toward the viewer)
 * both differ from the solver's model and camera frames (y down, z away) by
 * this half turn about x. It is its own inverse.
 */
const HALF_TURN_X: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

const BRIDGE_SEAT_MM: Vec3 = [
  CANONICAL_NOSE_BRIDGE_MM[0],
  CANONICAL_NOSE_BRIDGE_MM[1],
  CANONICAL_NOSE_BRIDGE_MM[2] - BRIDGE_FORWARD_OFFSET_MM,
];

/**
 * Glasses model space to the renderer's eye space (millimetres, camera at the
 * origin looking down -z). A model point p lands at
 * H (R (seat + H (p - bridge)) + t), with H the half turn, (R, t) the head
 * pose and seat the bridge seat in the face model.
 */
export function glassesTransform(pose: HeadPose, bridgeAnchorMm: Vec3): RigidTransform {
  const rotation = mat3Multiply(HALF_TURN_X, mat3Multiply(pose.rotation, HALF_TURN_X));
  const seatCamera = add(mat3MulVec3(pose.rotation, BRIDGE_SEAT_MM), pose.translationMm);
  const translationMm = subtract(
    mat3MulVec3(HALF_TURN_X, seatCamera),
    mat3MulVec3(rotation, bridgeAnchorMm),
  );
  return { rotation, translationMm };
}

/**
 * Where a glasses model point sits in the solver's face model frame,
 * seat + H (p - bridge). The head pose maps it to camera coordinates, which
 * lets the eval harness project the anchors of any pose it filters offline.
 */
export function glassesPointInFaceModel(point: Vec3, bridgeAnchorMm: Vec3): Vec3 {
  return add(BRIDGE_SEAT_MM, mat3MulVec3(HALF_TURN_X, subtract(point, bridgeAnchorMm)));
}

export function transformPoint(transform: RigidTransform, point: Vec3): Vec3 {
  return add(mat3MulVec3(transform.rotation, point), transform.translationMm);
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
