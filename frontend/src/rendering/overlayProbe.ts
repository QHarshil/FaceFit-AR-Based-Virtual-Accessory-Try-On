// Pose and render events for eval/harness (see utils/probe.ts). No-ops
// unless the harness installs a sink.
import { quaternionFromMatrix, type HeadPose, type Mat3 } from '@facefit/cv';
import * as THREE from 'three';
import { glassesPointInFaceModel, glassesTransform } from '../geometry/glassesPlacement';
import { MAX_RMS_REPROJECTION_MM, type HeadPoseEstimate } from '../geometry/headPose';
import { hasFace, landmarkPoint, type LandmarkFrame } from '../perception/types';
import type { ProductAnchors } from '../types';
import { probe } from '../utils/probe';
import { pageProjector, type PlacedGlasses, type Stage } from './overlayStage';

// Landmarks the eval harness needs for jitter, blink and registration metrics.
const PROBE_LANDMARKS = [1, 10, 33, 133, 145, 159, 168, 234, 263, 362, 374, 386, 454];

/** Three.js order, x y z w. */
const quaternionArray = (rotation: Mat3) => {
  const q = quaternionFromMatrix(rotation);
  return [q.x, q.y, q.z, q.w];
};

export const probeGlassesPose = (
  stage: Stage,
  frame: LandmarkFrame,
  estimate: HeadPoseEstimate,
  filtered: HeadPose | null,
  anchors: ProductAnchors,
  filterSetting: string,
) => {
  const intrinsics = estimate.intrinsics;
  const rawPose = estimate.fit?.pose ?? null;
  const poseStats = {
    frameTimestampMs: frame.timestampMs,
    faceCount: frame.faceCount,
    trackId: frame.trackId,
    poseFilter: filterSetting,
    focalPx: intrinsics?.fx ?? null,
    principalPx: intrinsics ? [intrinsics.cx, intrinsics.cy] : null,
    frameSize: intrinsics ? [intrinsics.width, intrinsics.height] : null,
    gateMaxRmsMm: MAX_RMS_REPROJECTION_MM,
    gated: !estimate.trusted,
    gateReason: estimate.trusted ? null : estimate.reason,
    rmsReprojectionPx: estimate.fit?.rmsReprojectionPx ?? null,
    rmsReprojectionMm: estimate.fit?.rmsReprojectionMm ?? null,
    inliers: estimate.fit?.inlierCount ?? null,
    // The solved pose before filtering, so the harness can replay any filter offline.
    headPose: rawPose
      ? {
          quaternion: quaternionArray(rawPose.rotation),
          translationMm: rawPose.translationMm,
        }
      : null,
    // Bridge and hinge anchors (wearer's right first) in the face model frame.
    anchorsFaceMm: [anchors.bridgeCenter, anchors.hingeRight, anchors.hingeLeft].map((anchor) =>
      glassesPointInFaceModel(anchor, anchors.bridgeCenter),
    ),
    landmarks: hasFace(frame)
      ? PROBE_LANDMARKS.map((i) => {
          const point = landmarkPoint(frame, i);
          return [point.x, point.y, point.z];
        })
      : null,
  };
  const pageNdc = pageProjector(stage);
  if (!estimate.trusted || !filtered || !rawPose || !pageNdc) {
    probe({ stage: 'glassesPose', t: performance.now(), ...poseStats });
    return;
  }
  const target = glassesTransform(rawPose, anchors.bridgeCenter);
  const smoothed = glassesTransform(filtered, anchors.bridgeCenter);
  const smoothedQuat = quaternionArray(smoothed.rotation);
  const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...smoothedQuat), 'XYZ');
  probe({
    stage: 'glassesPose',
    t: performance.now(),
    ...poseStats,
    // Decomposed for reporting only; the pose itself stays a rotation matrix.
    euler: [euler.x, euler.y, euler.z],
    // Target is the solved pose; smoothed is the filtered pose at the frame's
    // capture time, which renders see before prediction.
    targetNdc: pageNdc(target, anchors.bridgeCenter),
    smoothedNdc: pageNdc(smoothed, anchors.bridgeCenter),
    // Image left first: the wearer's right hinge, as the metrics expect.
    smoothedEndsNdc: [pageNdc(smoothed, anchors.hingeRight), pageNdc(smoothed, anchors.hingeLeft)],
    targetQuat: quaternionArray(target.rotation),
    smoothedQuat,
  });
};

/** The pose each render drew, at the render's start, and the capture time it was predicted to. */
export const probeRenderedPose = (
  stage: Stage,
  placed: PlacedGlasses,
  renderStart: number,
  anchors: ProductAnchors,
) => {
  const pageNdc = pageProjector(stage);
  if (!pageNdc) return;
  const { transform } = placed;
  probe({
    stage: 'renderedPose',
    t: renderStart,
    targetTimestampMs: placed.timestampMs,
    quat: quaternionArray(transform.rotation),
    centerNdc: pageNdc(transform, anchors.bridgeCenter),
    endsNdc: [pageNdc(transform, anchors.hingeRight), pageNdc(transform, anchors.hingeLeft)],
  });
};
