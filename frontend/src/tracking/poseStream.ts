// The 30 Hz pose stream, kept outside React. Each worker result is solved and
// filtered here; the overlay's render loop reads the pose directly, and React
// subscribes only to a coarse snapshot that changes when the face status does.
import type { HeadPose } from '@facefit/cv';
import { createOverlayPose, type RenderPose } from '../filtering/overlayPose';
import type { PoseFilterSetting } from '../filtering/poseFilterSetting';
import { createHeadPoseTracker, type HeadPoseEstimate } from '../geometry/headPose';
import { solveStillPose } from '../geometry/stillPose';
import { hasFace, type LandmarkFrame } from '../perception/types';
import {
  createFaceStatusTracker,
  DEFAULT_FACE_STATUS_OPTIONS,
  NO_FACE,
  type FaceStatus,
} from '../tryon/faceStatus';

export interface PoseUpdate {
  frame: LandmarkFrame;
  estimate: HeadPoseEstimate;
  /** The filtered pose at the frame's capture time, null when the frame was not trusted. */
  filtered: HeadPose | null;
}

export interface PoseSnapshot {
  face: FaceStatus;
  /**
   * The overlay is drawn: a trusted pose, or a short run of untrusted frames
   * after one. False while the gate hides a face that is in view.
   */
  poseShown: boolean;
}

export interface PoseStream {
  readonly setting: PoseFilterSetting;
  /** A worker result for a live camera frame. */
  push: (frame: LandmarkFrame) => void;
  /** A camera frame captured at `timestampMs` is on screen. */
  present: (timestampMs: number) => void;
  /**
   * A still photo: solves its pose once and draws it unfiltered until the
   * next push or reset. Returns whether the pose is trusted.
   */
  showStill: (frame: LandmarkFrame) => boolean;
  /** Starts over: no pose, no face. Used when the camera or the worker restarts. */
  reset: () => void;
  /** The pose the current render should draw. Read by the render loop each frame. */
  poseForRender: () => RenderPose | null;
  /**
   * Every processed frame, for the renderer. A listener added while a photo
   * is shown gets the photo's update at once, since it is published only
   * once. React components use `subscribe`.
   */
  onUpdate: (listener: (update: PoseUpdate) => void) => () => void;
  /** For useSyncExternalStore: fires only when `getSnapshot` changes. */
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PoseSnapshot;
}

const INITIAL: PoseSnapshot = { face: NO_FACE, poseShown: true };

export const createPoseStream = (setting?: PoseFilterSetting): PoseStream => {
  const tracker = createHeadPoseTracker();
  const overlayPose = createOverlayPose(setting);
  const faces = createFaceStatusTracker();
  const updateListeners = new Set<(update: PoseUpdate) => void>();
  const snapshotListeners = new Set<() => void>();
  let trackId: number | null = null;
  let snapshot = INITIAL;
  let untrustedRun = 0;
  let still: RenderPose | null = null;
  let stillUpdate: PoseUpdate | null = null;

  const publish = (next: PoseSnapshot) => {
    if (next.face === snapshot.face && next.poseShown === snapshot.poseShown) return;
    snapshot = next;
    snapshotListeners.forEach((listener) => {
      listener();
    });
  };

  const reset = () => {
    still = null;
    stillUpdate = null;
    trackId = null;
    untrustedRun = 0;
    tracker.reset();
    overlayPose.lose();
    faces.reset();
    publish(INITIAL);
  };

  return {
    setting: overlayPose.setting,
    push(frame) {
      still = null;
      stillUpdate = null;
      // Filter state carried to another face would swing the overlay across
      // from the last one.
      if (frame.trackId !== trackId) {
        trackId = frame.trackId;
        overlayPose.lose();
      }
      const estimate = tracker.update(frame);
      // A gated frame keeps the filter: a short gap continues the track and
      // a long one restarts it on the next pose. A lost face ends it.
      let filtered: HeadPose | null = null;
      if (estimate.trusted) filtered = overlayPose.update(estimate.fit.pose, frame.timestampMs);
      else if (estimate.reason === 'no-face') overlayPose.lose();
      updateListeners.forEach((listener) => {
        listener({ frame, estimate, filtered });
      });

      const tracked = hasFace(frame);
      untrustedRun = estimate.trusted || !tracked ? 0 : untrustedRun + 1;
      const face = faces.update({
        faceCount: frame.faceCount,
        tracked,
        ...(frame.luminance === undefined ? {} : { luminance: frame.luminance }),
      });
      // Debounced like a lost face, so a few gated frames do not flash a hint.
      publish({ face, poseShown: untrustedRun < DEFAULT_FACE_STATUS_OPTIONS.lostAfterFrames });
    },
    present(timestampMs) {
      overlayPose.present(timestampMs);
    },
    showStill(frame) {
      reset();
      const { estimate } = solveStillPose(frame);
      // Nothing to smooth in one frame, and no newer frame to go stale against.
      still = estimate.trusted ? { pose: estimate.fit.pose, timestampMs: frame.timestampMs } : null;
      const update: PoseUpdate = { frame, estimate, filtered: still?.pose ?? null };
      stillUpdate = update;
      updateListeners.forEach((listener) => {
        listener(update);
      });
      return still !== null;
    },
    reset,
    poseForRender: () => still ?? overlayPose.poseForRender(),
    onUpdate(listener) {
      updateListeners.add(listener);
      if (stillUpdate) listener(stillUpdate);
      return () => {
        updateListeners.delete(listener);
      };
    },
    subscribe(listener) {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  };
};
