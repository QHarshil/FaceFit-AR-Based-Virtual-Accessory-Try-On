// Shared perception types. Nothing here depends on the landmark model, so
// geometry, filtering and rendering code can import it freely.

/** Points per face in the refined face mesh, iris included. */
export const LANDMARK_COUNT = 478;

/** Values per landmark in `LandmarkFrame.landmarks`: x, y, z. */
export const LANDMARK_STRIDE = 3;

export type PerceptionDelegate = 'GPU' | 'CPU';

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

export interface LandmarkFrame {
  /** Capture time of the camera frame, in the main thread's `performance.now()` clock. */
  timestampMs: number;
  /** Size of the camera frame in pixels. */
  width: number;
  height: number;
  /**
   * First detected face as interleaved x, y, z. x and y are normalized to the
   * frame width and height; z uses roughly the same scale as x, smaller is
   * closer to the camera. Empty when `faceCount` is 0.
   */
  landmarks: Float32Array;
  faceCount: number;
}

export const hasFace = (frame: LandmarkFrame): boolean =>
  frame.faceCount > 0 && frame.landmarks.length === LANDMARK_COUNT * LANDMARK_STRIDE;

export const landmarkPoint = (frame: LandmarkFrame, index: number): LandmarkPoint => {
  if (!Number.isInteger(index) || index < 0 || index >= LANDMARK_COUNT || !hasFace(frame)) {
    throw new RangeError(`Landmark ${index} is not in this frame`);
  }
  const offset = index * LANDMARK_STRIDE;
  return {
    x: frame.landmarks[offset] as number,
    y: frame.landmarks[offset + 1] as number,
    z: frame.landmarks[offset + 2] as number,
  };
};
