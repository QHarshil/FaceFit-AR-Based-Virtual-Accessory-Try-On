import { RIGID_FACE_LANDMARKS } from '../faceModel.ts';
import type { Vec3 } from '../linalg.ts';

/** The wearer's right or left eye, as MediaPipe names them. The right eye is on the image left of an unmirrored frame. */
export type Eye = 'right' | 'left';

export const EYES: readonly Eye[] = ['right', 'left'];

/** Face Mesh landmark indices for one eye. */
export interface EyeLandmarkIndices {
  readonly irisCentre: number;
  /** The iris contour points on the eye's horizontal axis. */
  readonly irisHorizontal: readonly [number, number];
  readonly irisVertical: readonly [number, number];
  /** Eye corners, ordered by increasing model x. */
  readonly corners: readonly [number, number];
  readonly upperLid: number;
  readonly lowerLid: number;
}

/**
 * Iris indices exist only in the 478-landmark output (FaceLandmarker, or Face
 * Mesh with refined landmarks). On MediaPipe's output the horizontal contour
 * pair is 469 and 471 (474 and 476); the vertical pair spans about 0.87 of
 * the horizontal one.
 */
export const EYE_LANDMARKS: Readonly<Record<Eye, EyeLandmarkIndices>> = {
  right: { irisCentre: 468, irisHorizontal: [469, 471], irisVertical: [470, 472], corners: [33, 133], upperLid: 159, lowerLid: 145 },
  left: { irisCentre: 473, irisHorizontal: [474, 476], irisVertical: [475, 477], corners: [362, 263], upperLid: 386, lowerLid: 374 },
};

/**
 * Face-oval landmarks at the height of the eye corners, in front of the ears:
 * the face width a frame's temples span. Both are in the rigid set, so their
 * canonical positions are known.
 */
export const FACE_WIDTH_LANDMARKS: readonly [number, number] = [127, 356];

export const FACE_MESH_IRIS_LANDMARK_COUNT = 478;

export function canonicalPosition(landmarkIndex: number): Vec3 {
  const landmark = RIGID_FACE_LANDMARKS.find((candidate) => candidate.landmarkIndex === landmarkIndex);
  if (!landmark) throw new Error(`landmark ${landmarkIndex} is not in the rigid face model`);
  return landmark.positionMm;
}
