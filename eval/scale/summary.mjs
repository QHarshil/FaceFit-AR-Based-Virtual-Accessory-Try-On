// Runs the metric-scale pipeline over cached clip landmarks and reduces the
// result to numbers that are safe to record: relative spreads and widths,
// frame counts, never a measurement in millimetres.
import {
  RIGID_FACE_LANDMARKS,
  aggregateFaceMeasurements,
  estimateIntrinsics,
  measureFaceFrame,
  solveHeadPose,
} from '../../packages/cv/src/index.ts';

/** The app's overlay gate; a pose above it is not used to warm-start the next solve. */
const WARM_START_MAX_RMS_MM = 6;

/**
 * Measures every frame of a clip as the app would: pose from the rigid
 * landmarks, warm-started from the last trusted pose, then the frame's
 * scale and measurements. faces holds normalized [x, y] landmarks per frame,
 * or null where no face was found.
 */
export function measureClip(faces, width, height, horizontalFovDeg) {
  const intrinsics = estimateIntrinsics({ width, height, horizontalFovDeg });
  if (!intrinsics) throw new Error(`invalid camera: ${width}x${height}, ${horizontalFovDeg} deg`);
  let previous = null;
  const frames = faces.map((face) => {
    if (!face) return measureFaceFrame(null, null, intrinsics);
    const landmarksPx = face.map(([x, y]) => [x * width, y * height]);
    const pose = solveHeadPose(
      RIGID_FACE_LANDMARKS.map(({ landmarkIndex }) => landmarksPx[landmarkIndex]),
      RIGID_FACE_LANDMARKS,
      intrinsics,
      previous ? { initialPose: previous } : {},
    );
    if (pose.ok && (pose.rmsReprojectionPx * pose.translationMm[2]) / intrinsics.fx <= WARM_START_MAX_RMS_MM) previous = pose;
    return measureFaceFrame(landmarksPx, pose, intrinsics);
  });
  return aggregateFaceMeasurements(frames);
}

const round = (value, digits = 3) => Number(value.toFixed(digits));
const percent = (part, whole) => round((100 * part) / whole);

/**
 * An interval as percentages of its own median. A width in millimetres
 * would give the measurement away: the population term alone makes the
 * 95% width about 0.17 times the median.
 */
export function relativeInterval(interval) {
  return {
    frameSdPercent: percent(interval.frameSdMm, interval.medianMm),
    halfWidthPercent: percent((interval.upperMm - interval.lowerMm) / 2, interval.medianMm),
    noiseSdPercent: percent(interval.noiseSdMm, interval.medianMm),
    populationSdPercent: percent(interval.populationSdMm, interval.medianMm),
    modelSdPercent: percent(interval.modelSdMm, interval.medianMm),
    effectiveFrames: round(interval.effectiveFrames, 1),
  };
}

/** The recordable part of an aggregate: counts and relative numbers only. */
export function clipRecord(summary, frameCount) {
  const counts = { frames: frameCount, acceptedFrames: summary.acceptedFrames, rejectedFrames: summary.rejectedFrames };
  if (!summary.ok) return { ok: false, reason: summary.reason, ...counts };
  return {
    ok: true,
    ...counts,
    nearPupillaryDistance: relativeInterval(summary.nearPupillaryDistance),
    distancePupillaryDistance: relativeInterval(summary.distancePupillaryDistance),
    faceWidth: relativeInterval(summary.faceWidth),
    faceScaleFrameSdPercent: percent(summary.faceScale.frameSd, summary.faceScale.median),
  };
}

/** Relative change of each median from one summary to another, in percent. */
export function medianChangePercent(from, to) {
  if (!from.ok || !to.ok) return null;
  const change = (key) => round(100 * (to[key].medianMm / from[key].medianMm - 1));
  return {
    nearPupillaryDistance: change('nearPupillaryDistance'),
    distancePupillaryDistance: change('distancePupillaryDistance'),
    faceWidth: change('faceWidth'),
  };
}
