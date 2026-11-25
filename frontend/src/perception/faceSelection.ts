import type { LandmarkPoint } from './types';

const RIGHT_EYE_OUTER = 33;
const LEFT_EYE_OUTER = 263;
const FOREHEAD = 10;
const NOSE_TIP = 4;

/**
 * A face continues the track when its centre is within this many face sizes
 * of the tracked face's last centre. Two faces side by side are at least a
 * face width apart, 155 mm on the canonical face (landmarks 127 to 356) or
 * 1.7 sizes, so a neighbour never matches; a head moving half a metre per
 * second covers 0.2 sizes per frame at 30 Hz, so the tracked face still
 * matches after a few missed frames.
 */
export const MATCH_RADIUS = 0.75;

/** A face continues the track only when its size is within this factor of the last one. */
export const MAX_SIZE_CHANGE = 1.5;

/**
 * Frames the tracked face may go unmatched before another face can take the
 * overlay: half a second at 30 Hz. Missed detections in fast motion and a
 * hand passing in front of the face are shorter, and over them the overlay
 * stays hidden instead of moving to a bystander.
 */
export const MAX_MISSED_FRAMES = 15;

const distancePx = (a: LandmarkPoint, b: LandmarkPoint, width: number, height: number) =>
  Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);

/**
 * Size of a face in pixels: the larger of the outer eye corner distance and
 * the forehead to nose tip distance. Yaw shortens the first and leaves the
 * height of the second, which lies on the face's midline; pitch leaves the
 * first, and roll changes neither. On the canonical face both are about
 * 88 mm (88.9 and 87.2 mm frontal), so the larger stays within 5% of a
 * frontal face's size through 80 degrees of yaw, and within -6% and +12%
 * through 40 degrees of pitch (faceSelection.test.ts). The eye corner
 * distance alone falls to 0.6 of frontal at 50 degrees of yaw, below a
 * frontal bystander at 0.8 of the user's size.
 */
export const faceSizePx = (
  face: readonly LandmarkPoint[],
  width: number,
  height: number,
): number | null => {
  const right = face[RIGHT_EYE_OUTER];
  const left = face[LEFT_EYE_OUTER];
  const forehead = face[FOREHEAD];
  const noseTip = face[NOSE_TIP];
  if (!right || !left || !forehead || !noseTip) return null;
  return Math.max(
    distancePx(right, left, width, height),
    distancePx(forehead, noseTip, width, height),
  );
};

interface FaceSpan {
  readonly centerPx: readonly [number, number];
  readonly sizePx: number;
}

const spanOf = (face: readonly LandmarkPoint[], width: number, height: number): FaceSpan | null => {
  const sizePx = faceSizePx(face, width, height);
  const right = face[RIGHT_EYE_OUTER];
  const left = face[LEFT_EYE_OUTER];
  if (sizePx === null || !right || !left) return null;
  return {
    centerPx: [((left.x + right.x) / 2) * width, ((left.y + right.y) / 2) * height],
    sizePx,
  };
};

/** Index of the span that continues `tracked`, or -1 when none does. */
const continuation = (spans: readonly (FaceSpan | null)[], tracked: FaceSpan): number => {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  spans.forEach((span, i) => {
    if (!span) return;
    const sizeRatio = span.sizePx / tracked.sizePx;
    if (sizeRatio > MAX_SIZE_CHANGE || sizeRatio < 1 / MAX_SIZE_CHANGE) return;
    const distance =
      Math.hypot(span.centerPx[0] - tracked.centerPx[0], span.centerPx[1] - tracked.centerPx[1]) /
      tracked.sizePx;
    if (distance <= MATCH_RADIUS && distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
};

const largest = (spans: readonly (FaceSpan | null)[]): number =>
  spans.reduce(
    (best, span, i) => (span && (best < 0 || span.sizePx > spans[best]!.sizePx) ? i : best),
    -1,
  );

export interface TrackedFace {
  /** Index of the face in this frame's list of faces. */
  readonly index: number;
  /** The same while the selector follows one face, new when it moves to another. */
  readonly trackId: number;
}

export interface TrackedFaceSelector {
  /**
   * The face to track among `faces` (landmarks normalized to a `width` by
   * `height` frame), or null when there is none or the tracked face was
   * missed in this frame.
   */
  select(
    faces: readonly (readonly LandmarkPoint[])[],
    width: number,
    height: number,
  ): TrackedFace | null;
}

/**
 * Chooses which of several detected faces the overlay follows. MediaPipe does
 * not keep faces in a stable order, so faces are matched to the tracked one
 * by position and size from frame to frame. A track starts on the largest
 * face, taken to be the user's, nearest the camera, and ends only after the
 * tracked face has gone unmatched for more than MAX_MISSED_FRAMES frames.
 * Size never moves the overlay off a tracked face.
 */
export const createTrackedFaceSelector = (): TrackedFaceSelector => {
  let track: { id: number; span: FaceSpan; missedFrames: number } | null = null;
  let lastId = 0;
  return {
    select(faces, width, height) {
      const spans = faces.map((face) => spanOf(face, width, height));
      if (track) {
        const index = continuation(spans, track.span);
        if (index >= 0) {
          track.span = spans[index]!;
          track.missedFrames = 0;
          return { index, trackId: track.id };
        }
        track.missedFrames += 1;
        if (track.missedFrames <= MAX_MISSED_FRAMES) return null;
        track = null;
      }
      const index = largest(spans);
      if (index < 0) return null;
      lastId += 1;
      track = { id: lastId, span: spans[index]!, missedFrames: 0 };
      return { index, trackId: track.id };
    },
  };
};
