// The app's current eye-line heuristic (frontend/src/components/ARTryOn.tsx,
// updateGlasses) as a pure function with the same math and constants. It is a
// heuristic: hand-tuned gains on angles of the eye line, not a fitted model.
import { rotationFromEulerXYZ } from './conventions.mjs';

const LEFT_EYE_INDICES = [33, 133, 159, 145];
const RIGHT_EYE_INDICES = [362, 263, 386, 374];
const LEFT_TEMPLE_INDEX = 234;
const RIGHT_TEMPLE_INDEX = 454;
const FOREHEAD_INDEX = 10;
const EPSILON = 1e-6;

const average = (landmarks, indices) => {
  const sum = indices.reduce((acc, i) => [acc[0] + landmarks[i].x, acc[1] + landmarks[i].y, acc[2] + landmarks[i].z], [0, 0, 0]);
  return sum.map((v) => v / indices.length);
};

/**
 * Euler angles [pitch, yaw, roll] in radians, Three.js order 'XYZ', from
 * normalized landmarks ({x, y, z}, 478 of them). Null where the app hides the
 * glasses: a non-finite or zero temple distance.
 */
export function heuristicEuler(landmarks) {
  const leftTemple = landmarks[LEFT_TEMPLE_INDEX];
  const rightTemple = landmarks[RIGHT_TEMPLE_INDEX];
  const faceWidth = Math.hypot(rightTemple.x - leftTemple.x, rightTemple.y - leftTemple.y, rightTemple.z - leftTemple.z);
  if (!Number.isFinite(faceWidth) || faceWidth < EPSILON) return null;

  const leftEye = average(landmarks, LEFT_EYE_INDICES);
  const rightEye = average(landmarks, RIGHT_EYE_INDICES);
  const eyeMidpointY = (leftEye[1] + rightEye[1]) / 2;
  const [ex, ey, ez] = [rightEye[0] - leftEye[0], rightEye[1] - leftEye[1], rightEye[2] - leftEye[2]];
  const horizontalMagnitude = Math.sqrt(ex * ex + ez * ez) || EPSILON;

  const yaw = Math.atan2(ez, ex) * 0.8;
  const pitch = Math.atan2(-ey, horizontalMagnitude) * 0.75 + 0.08;
  const verticalReferenceY = landmarks[FOREHEAD_INDEX].y - eyeMidpointY;
  const roll = Math.atan2(ey, ex) * 0.55 + verticalReferenceY * 0.3;
  return [pitch, yaw, roll];
}

/** The rotation the app gives the glasses, in the benchmark camera frame, or null. */
export function heuristicRotation(landmarks) {
  const euler = heuristicEuler(landmarks);
  return euler && rotationFromEulerXYZ(euler);
}
