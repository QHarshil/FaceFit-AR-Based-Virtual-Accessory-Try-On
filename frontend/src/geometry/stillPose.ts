// Head pose for a still photo, whose lens is unknown. The live camera assumes
// one field of view (DEFAULT_HORIZONTAL_FOV_DEG); a photo can come from a
// lens much longer or wider, and a wrong focal length bends the rigid fit far
// enough for the reprojection gate to reject it. So the photo is solved at
// each candidate field of view and the trusted fit with the smallest
// reprojection error in pixels is kept. One face pins the focal length only
// loosely; the overlay stays aligned because it is drawn with the intrinsics
// its pose was solved with.
import type { LandmarkFrame } from '../perception/types';
import { createHeadPoseTracker, type HeadPoseEstimate } from './headPose';

/** Horizontal fields of view tried for a photo, in degrees. */
export const STILL_FOV_CANDIDATES_DEG = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70] as const;

export interface StillPose {
  estimate: HeadPoseEstimate;
  /** The field of view of the kept fit; null when no candidate was trusted. */
  horizontalFovDeg: number | null;
}

export const solveStillPose = (
  frame: LandmarkFrame,
  candidates: readonly number[] = STILL_FOV_CANDIDATES_DEG,
): StillPose => {
  let best: StillPose | null = null;
  let bestRmsPx = Number.POSITIVE_INFINITY;
  let first: HeadPoseEstimate | null = null;
  for (const horizontalFovDeg of candidates) {
    const estimate = createHeadPoseTracker({ horizontalFovDeg }).update(frame);
    first ??= estimate;
    if (estimate.trusted && estimate.fit.rmsReprojectionPx < bestRmsPx) {
      bestRmsPx = estimate.fit.rmsReprojectionPx;
      best = { estimate, horizontalFovDeg };
    }
  }
  if (best) return best;
  // Untrusted at every field of view: report the reason from the first.
  return { estimate: first ?? createHeadPoseTracker().update(frame), horizontalFovDeg: null };
};
