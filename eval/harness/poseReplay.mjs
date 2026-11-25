// Replays a recorded run through a pose filter offline. The run must come
// from a build with the filter off, so its pose samples carry the solved
// poses. The replay mirrors the app (frontend/src/filtering/overlayPose.ts):
// each shown pose sample updates the filter at its frame's capture time, a
// lost face resets it, and each render predicts to the newest presented
// frame's capture time. Renders happen where the run rendered the glasses;
// the gate decides that, not the filter. The warmup's events run first, so
// the filter has settled when the measured events start.
import { matrixFromQuaternion, quaternionFromMatrix } from '../../packages/cv/src/index.ts';

const quaternionOf = ([x, y, z, w]) => ({ w, x, y, z });

const headPoseOf = (sample) => ({
  rotation: matrixFromQuaternion(quaternionOf(sample.headPose.quaternion)),
  translationMm: sample.headPose.translationMm,
});

/** Page pixels of face-model points under a head pose, through the pinhole and the cover fit. */
export const pageProjection = (sample, video, viewport) => {
  const [width, height] = sample.frameSize;
  const [cx, cy] = sample.principalPx;
  const f = sample.focalPx;
  const scale = Math.max(viewport[0] / video[0], viewport[1] / video[1]);
  const offset = [(viewport[0] - video[0] * scale) / 2, (viewport[1] - video[1] * scale) / 2];
  // The landmark frame and the video share a size in the harness; scale anyway.
  const toVideo = [video[0] / width, video[1] / height];
  return (pose, point) => {
    const r = pose.rotation;
    const t = pose.translationMm;
    const x = r[0] * point[0] + r[1] * point[1] + r[2] * point[2] + t[0];
    const y = r[3] * point[0] + r[4] * point[1] + r[5] * point[2] + t[1];
    const z = r[6] * point[0] + r[7] * point[1] + r[8] * point[2] + t[2];
    const u = ((f * x) / z + cx) * toVideo[0];
    const v = ((f * y) / z + cy) * toVideo[1];
    return [u * scale + offset[0], v * scale + offset[1]];
  };
};

// Three.js order x y z w, as the app probes it. The jitter metrics only use
// angles between rotations, which the glasses frame change leaves alone.
const quaternionArray = (m) => {
  const q = quaternionFromMatrix(m);
  return [q.x, q.y, q.z, q.w];
};

/**
 * Replays `run` with the filter from `createFilter()`, or none when it
 * returns null. Returns what each render drew ({ t, centerPx, endsPx, quat })
 * and the filtered pose of each shown pose sample at its frame time
 * ({ t, frameTimestampMs, centerPx, endsPx, quat }).
 */
export const replayRun = (run, createFilter) => {
  const { video, viewport } = run.environment;
  const filter = createFilter();
  let latest = null;
  let presentedMs = Number.NEGATIVE_INFINITY;
  let project = null;
  let anchors = null;
  const renders = [];
  const frames = [];
  const draw = (pose) => {
    const [center, right, left] = anchors.map((a) => project(pose, a));
    return { centerPx: center, endsPx: [right, left], quat: quaternionArray(pose.rotation) };
  };
  const warmup = run.warmupEvents ?? [];
  for (const [i, e] of [...warmup, ...run.events].entries()) {
    const measured = i >= warmup.length;
    if (e.stage === 'capture') {
      presentedMs = Math.max(presentedMs, e.timestampMs);
    } else if (e.stage === 'glassesPose') {
      if (e.gated) {
        if (e.gateReason === 'no-face') {
          latest = null;
          filter?.reset();
        }
        continue;
      }
      if (!e.headPose) throw new Error('pose sample without headPose; record the run with --pose-filter off');
      project ??= pageProjection(e, video, viewport);
      anchors ??= e.anchorsFaceMm;
      const solved = headPoseOf(e);
      const pose = filter ? filter.update(solved, e.frameTimestampMs) : solved;
      latest = { pose, timestampMs: e.frameTimestampMs };
      if (measured) frames.push({ t: e.t, frameTimestampMs: e.frameTimestampMs, ...draw(pose) });
    } else if (e.stage === 'renderedPose' && latest && measured) {
      const pose = filter ? filter.predict(Math.max(presentedMs, latest.timestampMs)) : latest.pose;
      // Past the filter's staleness limit the app hides the overlay and records no render.
      if (pose) renders.push({ t: e.t, ...draw(pose) });
    }
  }
  return { renders, frames };
};
