// Runs the metric-scale pipeline over cached clip landmarks and reduces the
// result to numbers that are safe to record: relative spreads and widths,
// frame counts, never a measurement in millimetres.
import {
  EYE_LANDMARKS,
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

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
};
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Dimensionless facts about MediaPipe's eye landmarks that the scale code's
 * constants rest on: the iris contour's vertical over horizontal extent, the
 * frame-to-frame spread of eye openness on open frames, and how narrow the
 * iris reads as the lids close, relative to fully open frames. Nothing here
 * is a length.
 */
export function landmarkDiagnostics(faces, width, height) {
  const rows = faces.filter(Boolean).map((face) => {
    const at = (index) => [face[index][0] * width, face[index][1] * height];
    const eyes = Object.values(EYE_LANDMARKS).map((eye) => ({
      horizontal: gap(at(eye.irisHorizontal[0]), at(eye.irisHorizontal[1])),
      vertical: gap(at(eye.irisVertical[0]), at(eye.irisVertical[1])),
      openness: gap(at(eye.upperLid), at(eye.lowerLid)) / gap(at(eye.corners[0]), at(eye.corners[1])),
    }));
    return {
      aspect: eyes.map((eye) => eye.vertical / eye.horizontal),
      irisWidth: (eyes[0].horizontal + eyes[1].horizontal) / 2,
      openness: Math.min(eyes[0].openness, eyes[1].openness),
    };
  });
  const typicalOpenness = median(rows.map((row) => row.openness));
  const open = rows.filter((row) => row.openness >= 0.95 * typicalOpenness);
  const openIrisWidth = median(open.map((row) => row.irisWidth));
  const openOpenness = open.map((row) => row.openness);
  const meanOpen = openOpenness.reduce((sum, value) => sum + value, 0) / openOpenness.length;
  const sdOpen = Math.sqrt(openOpenness.reduce((sum, value) => sum + (value - meanOpen) ** 2, 0) / (openOpenness.length - 1));
  const bins = [[0, 0.5], [0.5, 0.9], [0.9, 0.95], [0.95, Infinity]];
  return {
    irisVerticalOverHorizontal: round(median(rows.flatMap((row) => row.aspect))),
    openFrameOpennessSdPercent: percent(sdOpen, meanOpen),
    irisWidthByRelativeOpenness: bins.map(([low, high]) => {
      const inBin = rows.filter((row) => row.openness >= low * typicalOpenness && row.openness < high * typicalOpenness);
      return {
        relativeOpenness: [low, high === Infinity ? null : high],
        frames: inBin.length,
        irisWidthChangePercent: inBin.length ? round(100 * (median(inBin.map((row) => row.irisWidth)) / openIrisWidth - 1), 2) : null,
      };
    }),
  };
}
