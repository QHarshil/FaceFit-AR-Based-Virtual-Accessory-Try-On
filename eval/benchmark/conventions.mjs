// Rotation conventions for the AFLW2000-3D benchmark. Every method's output is
// expressed in one camera frame and then decomposed with the dataset's angle
// definition, so no method gets its own sign fixes. Derivation:
// docs/pose-benchmark.md.
//
// Camera frame: x image-right, y image-up, z toward the viewer. A frontal,
// upright face has rotation I. 3DDFA's projection, MediaPipe's metric space
// and the app's Three.js scene all use this frame.
import { mat3Multiply, mat3Transpose, symmetricEigen } from '../../packages/cv/src/linalg.ts';

/** Row-major 3x3 rotation about x by angle a, as 3DDFA's RotationMatrix.m writes it. */
const aflwRx = (a) => [1, 0, 0, 0, Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a)];
const aflwRy = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a)];
const aflwRz = (a) => [Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 1];

/**
 * 3DDFA's R = Rx(pitch) Ry(yaw) Rz(roll), with each factor the transpose of the
 * right-handed rotation. Pose_Para holds [pitch, yaw, roll, tx, ty, tz, f] and
 * the fit projects a model point X to f R X + t before flipping image y.
 */
export function aflwRotation({ pitch, yaw, roll }) {
  return mat3Multiply(aflwRx(pitch), mat3Multiply(aflwRy(yaw), aflwRz(roll)));
}

/**
 * Inverse of aflwRotation on the branch |yaw| <= pi/2. From the product,
 * R[0][2] = -sin(yaw), R[1][2] / R[2][2] = tan(pitch), R[0][1] / R[0][0] = tan(roll).
 */
export function aflwAngles(rotation) {
  const [r00, r01, r02, , , r12, , , r22] = rotation;
  return {
    pitch: Math.atan2(r12, r22),
    yaw: Math.asin(Math.max(-1, Math.min(1, -r02))),
    roll: Math.atan2(r01, r00),
  };
}

const wrapRadians = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The other angle triple for the same rotation, with |yaw| >= pi/2. Labels in
 * the protocol reach 99 degrees of yaw, past the principal branch.
 */
export function equivalentAflwAngles({ pitch, yaw, roll }) {
  return { pitch: wrapRadians(pitch + Math.PI), yaw: wrapRadians(Math.PI - yaw), roll: wrapRadians(roll + Math.PI) };
}

/** Solver frame (x right, y down, z forward, model with y and z negated) to the camera frame: F R F, F = diag(1, -1, -1). */
export function cameraRotationFromSolver(rotation) {
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = rotation;
  return [r00, -r01, -r02, -r10, r11, r12, -r20, r21, r22];
}

/** Three.js Euler order 'XYZ': R = Rx(x) Ry(y) Rz(z) with right-handed factors. */
export function rotationFromEulerXYZ([x, y, z]) {
  return mat3Multiply(aflwRx(-x), mat3Multiply(aflwRy(-y), aflwRz(-z)));
}

const LAYOUT_TOLERANCE = 1e-6;

/**
 * Rotation of MediaPipe's facial transformation matrix, a column-major 4x4
 * from the canonical face to metric camera space. The bottom row must be
 * (0, 0, 0, 1), which also rejects a row-major matrix with a translation.
 * Returns null for any other shape. The Procrustes fit can carry a uniform
 * scale, so the rotation is the polar factor M (M^T M)^(-1/2).
 */
export function rotationFromMediapipeMatrix(matrix) {
  const { rows, columns, data } = matrix ?? {};
  if (rows !== 4 || columns !== 4 || !Array.isArray(data) || data.length !== 16 || !data.every(Number.isFinite)) return null;
  const bottomRow = [data[3], data[7], data[11], data[15] - 1];
  if (bottomRow.some((v) => Math.abs(v) > LAYOUT_TOLERANCE)) return null;
  const m = [data[0], data[4], data[8], data[1], data[5], data[9], data[2], data[6], data[10]];
  return polarRotation(m);
}

/** Nearest rotation to a matrix with positive determinant, or null if it is singular or reflecting. */
export function polarRotation(m) {
  const { values, vectors } = symmetricEigen(mat3Multiply(mat3Transpose(m), m), 3);
  if (!(values[0] > 0)) return null;
  const inverseRoot = new Array(9).fill(0);
  for (let k = 0; k < 3; k++) {
    const scale = 1 / Math.sqrt(values[k]);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) inverseRoot[i * 3 + j] += scale * vectors[k * 3 + i] * vectors[k * 3 + j];
    }
  }
  const rotation = mat3Multiply(m, inverseRoot);
  const det =
    rotation[0] * (rotation[4] * rotation[8] - rotation[5] * rotation[7]) -
    rotation[1] * (rotation[3] * rotation[8] - rotation[5] * rotation[6]) +
    rotation[2] * (rotation[3] * rotation[7] - rotation[4] * rotation[6]);
  return det > 0 ? rotation : null;
}
