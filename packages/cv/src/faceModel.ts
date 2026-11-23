import { CANONICAL_PROCRUSTES_LANDMARKS } from './canonicalFaceModel.ts';
import type { Vec3 } from './linalg.ts';

/**
 * A rigid face landmark in model coordinates (millimetres; x right, y down,
 * z away from the camera for a frontal face), keyed by MediaPipe Face Mesh
 * landmark index. Weights sum to 1.
 */
export interface FaceModelLandmark {
  readonly landmarkIndex: number;
  readonly positionMm: Vec3;
  readonly weight: number;
}

/**
 * Median vertical shift in pixels during a blink, from the owner's MediaPipe
 * recording. Landmark 6 uses the value measured at 168, its neighbour on the
 * nose bridge. The forehead outline (54, 67, 284, 297) was not measured and
 * takes the value of forehead landmark 10.
 */
const BLINK_SHIFT_PX: ReadonlyMap<number, number> = new Map([
  [6, 3.2],
  [133, 3.2],
  [362, 3.2],
  [10, 7.2],
  [54, 7.2],
  [67, 7.2],
  [284, 7.2],
  [297, 7.2],
  [33, 8.4],
  [263, 8.4],
]);

/** Nose tip shift during a blink, the smallest in the recording. */
const NOSE_TIP_BLINK_SHIFT_PX = 1.2;

/**
 * Google's Procrustes weights, with blink-affected landmarks scaled by
 * nose-tip shift over their own shift (a heuristic, not a fitted noise
 * model): outer eye corners to 0.14, forehead to 0.17, inner eye corners and
 * nose bridge to 0.38. The set already excludes eyelids and lips. Other
 * landmarks keep their weight because no blink data covers them.
 */
function blinkAdjustedWeights(): FaceModelLandmark[] {
  const adjusted = CANONICAL_PROCRUSTES_LANDMARKS.map((landmark) => {
    const shift = BLINK_SHIFT_PX.get(landmark.landmarkIndex);
    const scale = shift === undefined ? 1 : Math.min(1, NOSE_TIP_BLINK_SHIFT_PX / shift);
    return {
      landmarkIndex: landmark.landmarkIndex,
      positionMm: landmark.positionMm,
      weight: landmark.procrustesWeight * scale,
    };
  });
  const total = adjusted.reduce((sum, landmark) => sum + landmark.weight, 0);
  return adjusted.map((landmark) => ({ ...landmark, weight: landmark.weight / total }));
}

export const RIGID_FACE_LANDMARKS: readonly FaceModelLandmark[] = blinkAdjustedWeights();

export const RIGID_FACE_LANDMARK_INDICES: readonly number[] = RIGID_FACE_LANDMARKS.map(
  (landmark) => landmark.landmarkIndex,
);
