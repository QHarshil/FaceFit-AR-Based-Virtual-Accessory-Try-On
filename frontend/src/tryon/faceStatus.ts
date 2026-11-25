// Turns per-frame face counts and frame brightness into the coarse face status
// the statechart and the status line use. Debounced, so a face the detector
// misses for a few frames, or a passer-by in one frame, is not announced.

export interface FaceStatus {
  /** Faces in view, capped at 2. */
  faces: number;
  /** The overlay's face is in view. */
  tracked: boolean;
  /** The frame is too dark; only meaningful while no face is tracked. */
  lowLight: boolean;
}

export type FaceState = 'multiple' | 'tracking' | 'lowLight' | 'none';

export const faceStateOf = ({ faces, tracked, lowLight }: FaceStatus): FaceState => {
  if (tracked) return faces > 1 ? 'multiple' : 'tracking';
  return lowLight ? 'lowLight' : 'none';
};

export interface FaceFrame {
  faceCount: number;
  tracked: boolean;
  /** Mean luma of the frame, 0 to 255, on the frames the worker samples. */
  luminance?: number;
}

export interface FaceStatusOptions {
  /** Consecutive frames without the tracked face before it counts as lost. */
  lostAfterFrames: number;
  /** Consecutive frames with a different face count before the count changes. */
  countAfterFrames: number;
  /** Mean luma below which a sample counts as dark. */
  darkBelow: number;
  /** Mean luma above which a sample clears low light. The gap stops flicker at the boundary. */
  brightAbove: number;
  /** Consecutive dark samples before low light is reported. */
  darkSamples: number;
}

// At the camera's 30 Hz: a face is lost after a third of a second without it,
// and a second face counts after half a second. The worker samples brightness
// twice a second (LUMINANCE_SAMPLE_INTERVAL), so low light needs a second of
// dark frames. The dark boundary, a mean luma of 40 out of 255, is a chosen
// value, not a measured detection limit; the try-on reports low light only
// while no face is found, so a dark frame with a tracked face is not flagged.
export const DEFAULT_FACE_STATUS_OPTIONS: FaceStatusOptions = {
  lostAfterFrames: 10,
  countAfterFrames: 15,
  darkBelow: 40,
  brightAbove: 55,
  darkSamples: 2,
};

export const NO_FACE: FaceStatus = { faces: 0, tracked: false, lowLight: false };

export interface FaceStatusTracker {
  /** The status after this frame; the same object while nothing changed. */
  update(frame: FaceFrame): FaceStatus;
  reset(): void;
}

export const createFaceStatusTracker = (
  options: FaceStatusOptions = DEFAULT_FACE_STATUS_OPTIONS,
): FaceStatusTracker => {
  let status = NO_FACE;
  let missedFrames = 0;
  let candidateFaces = 0;
  let candidateFrames = 0;
  let darkRun = 0;

  return {
    update(frame) {
      const faces = Math.min(frame.faceCount, 2);
      let { tracked, lowLight } = status;
      let shownFaces = status.faces;

      if (frame.tracked) {
        tracked = true;
        missedFrames = 0;
      } else {
        missedFrames += 1;
        if (missedFrames >= options.lostAfterFrames) tracked = false;
      }

      if (faces === shownFaces) {
        candidateFrames = 0;
      } else {
        candidateFrames = faces === candidateFaces ? candidateFrames + 1 : 1;
        candidateFaces = faces;
        // The first face shows at once; changes after that wait out the debounce.
        if (shownFaces === 0 || candidateFrames >= options.countAfterFrames) {
          shownFaces = faces;
          candidateFrames = 0;
        }
      }

      if (frame.luminance !== undefined) {
        if (frame.luminance < options.darkBelow) {
          darkRun += 1;
          if (darkRun >= options.darkSamples) lowLight = true;
        } else {
          darkRun = 0;
          if (frame.luminance > options.brightAbove) lowLight = false;
        }
      }

      if (
        tracked !== status.tracked ||
        lowLight !== status.lowLight ||
        shownFaces !== status.faces
      ) {
        status = { faces: shownFaces, tracked, lowLight };
      }
      return status;
    },
    reset() {
      status = NO_FACE;
      missedFrames = 0;
      candidateFaces = 0;
      candidateFrames = 0;
      darkRun = 0;
    },
  };
};
