import type { LandmarkPoint } from './types';

/** Outer eye corners in the face mesh: their distance sizes a face and their midpoint places it. */
const RIGHT_EYE_OUTER = 33;
const LEFT_EYE_OUTER = 263;

/**
 * Another face replaces the tracked one only when its inter-ocular distance is
 * larger by this factor, so two faces of similar size do not swap on landmark
 * noise from frame to frame.
 */
export const SWITCH_RATIO = 1.25;

interface FaceSpan {
  readonly centerPx: readonly [number, number];
  readonly interocularPx: number;
}

const spanOf = (face: readonly LandmarkPoint[], width: number, height: number): FaceSpan | null => {
  const right = face[RIGHT_EYE_OUTER];
  const left = face[LEFT_EYE_OUTER];
  if (!right || !left) return null;
  const dx = (left.x - right.x) * width;
  const dy = (left.y - right.y) * height;
  return {
    centerPx: [((left.x + right.x) / 2) * width, ((left.y + right.y) / 2) * height],
    interocularPx: Math.hypot(dx, dy),
  };
};

export interface TrackedFaceSelector {
  /**
   * Index in `faces` (landmarks normalized to a `width` by `height` frame) of
   * the face to track, or null when there is none.
   */
  select(
    faces: readonly (readonly LandmarkPoint[])[],
    width: number,
    height: number,
  ): number | null;
}

/**
 * Chooses which of several detected faces the overlay follows. MediaPipe does
 * not keep faces in a stable order, so the choice is made here: the largest
 * face by inter-ocular distance, kept from frame to frame (the face nearest
 * the last one, within one inter-ocular distance of it) until another is
 * larger by SWITCH_RATIO or it is gone.
 */
export const createTrackedFaceSelector = (): TrackedFaceSelector => {
  let tracked: FaceSpan | null = null;
  return {
    select(faces, width, height) {
      const spans = faces.map((face) => spanOf(face, width, height));
      let largest = -1;
      let incumbent = -1;
      let incumbentDistance = Number.POSITIVE_INFINITY;
      spans.forEach((span, i) => {
        if (!span) return;
        if (largest < 0 || span.interocularPx > spans[largest]!.interocularPx) largest = i;
        if (!tracked) return;
        const distance = Math.hypot(
          span.centerPx[0] - tracked.centerPx[0],
          span.centerPx[1] - tracked.centerPx[1],
        );
        if (distance <= tracked.interocularPx && distance < incumbentDistance) {
          incumbent = i;
          incumbentDistance = distance;
        }
      });
      const keep =
        incumbent >= 0 &&
        spans[largest]!.interocularPx <= SWITCH_RATIO * spans[incumbent]!.interocularPx;
      const chosen = keep ? incumbent : largest;
      tracked = chosen >= 0 ? spans[chosen]! : null;
      return chosen >= 0 ? chosen : null;
    },
  };
};
