// Runs the metric-scale pipeline over cached clip landmarks and reduces the
// result to the fields that are safe to record for a recorded face. A field
// is safe when no combination of recorded fields rebuilds a PD, face width
// or face scale: counts, frame-to-frame spreads, half-widths rounded to whole
// percent, clip-to-clip agreement and dimensionless landmark diagnostics.
// Terms that depend on depth or focal length (the distance-PD conversion
// and face-width model SDs, focal sensitivity) give the face scale away
// together, so recordings never store them.
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
export function measureClipFrames(faces, width, height, horizontalFovDeg) {
  const intrinsics = estimateIntrinsics({ width, height, horizontalFovDeg });
  if (!intrinsics) throw new Error(`invalid camera: ${width}x${height}, ${horizontalFovDeg} deg`);
  let previous = null;
  return faces.map((face) => {
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
}

export function measureClip(faces, width, height, horizontalFovDeg) {
  return aggregateFaceMeasurements(measureClipFrames(faces, width, height, horizontalFovDeg));
}

const round = (value, digits = 3) => Number(value.toFixed(digits));
const percent = (part, whole) => round((100 * part) / whole);
const halfWidthPercent = (interval) => Math.round((50 * (interval.upperMm - interval.lowerMm)) / interval.medianMm);

/**
 * The recordable part of an aggregate. Near PD and face width keep their
 * frame SD; distance PD keeps only its half-width, because its frame spread
 * passes through the fixation distance. Half-widths are rounded to whole
 * percent, which leaves the population term (8.4%) and hides the depth- and
 * focal-dependent model terms inside them.
 */
export function clipRecord(summary, frameCount) {
  const counts = { frames: frameCount, acceptedFrames: summary.acceptedFrames, rejectedFrames: summary.rejectedFrames };
  if (!summary.ok) return { ok: false, reason: summary.reason, ...counts };
  return {
    ok: true,
    ...counts,
    nearPupillaryDistance: {
      frameSdPercent: percent(summary.nearPupillaryDistance.frameSdMm, summary.nearPupillaryDistance.medianMm),
      halfWidthPercent: halfWidthPercent(summary.nearPupillaryDistance),
    },
    distancePupillaryDistance: { halfWidthPercent: halfWidthPercent(summary.distancePupillaryDistance) },
    faceWidth: {
      frameSdPercent: percent(summary.faceWidth.frameSdMm, summary.faceWidth.medianMm),
      halfWidthPercent: halfWidthPercent(summary.faceWidth),
    },
  };
}

/** Relative change of the near-PD and face-width medians from one summary to another, in percent. */
export function medianChangePercent(from, to) {
  if (!from.ok || !to.ok) return null;
  const change = (key) => round(100 * (to[key].medianMm / from[key].medianMm - 1));
  return { nearPupillaryDistance: change('nearPupillaryDistance'), faceWidth: change('faceWidth') };
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
 * frame-to-frame spread of eye openness on open frames, the right-over-left
 * iris diameter ratio, and how narrow the iris reads as the lids close,
 * relative to fully open frames. Nothing here is a length, and none of it
 * depends on depth or focal length.
 */
export function landmarkDiagnostics(faces, width, height, frames = measureClipFrames(faces, width, height, 60)) {
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
    irisDiameterRatio: irisDiameterRatioSpread(frames),
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

/** Percentiles of the right-over-left iris diameter ratio over measured frames with open eyes and both irises. */
function irisDiameterRatioSpread(frames) {
  const measured = frames.filter((frame) => frame.ok);
  if (!measured.length) return null;
  const openFloor = 0.9 * median(measured.map((frame) => frame.eyeOpenness));
  const ratios = measured
    .filter((frame) => frame.eyeOpenness >= openFloor && frame.irisDiameterRatio !== null)
    .map((frame) => frame.irisDiameterRatio)
    .sort((a, b) => a - b);
  if (!ratios.length) return null;
  const at = (q) => round(ratios[Math.min(ratios.length - 1, Math.floor(q * ratios.length))]);
  return { frames: ratios.length, p1: at(0.01), median: round(median(ratios)), p99: at(0.99) };
}

/** Everything recorded for one recorded clip, provenance aside. */
export function recordClip(faces, width, height, horizontalFovDeg) {
  const frames = measureClipFrames(faces, width, height, horizontalFovDeg);
  const summary = aggregateFaceMeasurements(frames);
  return { summary, record: { ...clipRecord(summary, faces.length), landmarkDiagnostics: landmarkDiagnostics(faces, width, height, frames) } };
}

const REJECTIONS = Object.keys(aggregateFaceMeasurements([]).rejectedFrames);
const DIAGNOSTICS = [
  'landmarkDiagnostics.irisVerticalOverHorizontal',
  'landmarkDiagnostics.openFrameOpennessSdPercent',
  'landmarkDiagnostics.irisDiameterRatio.frames',
  'landmarkDiagnostics.irisDiameterRatio.p1',
  'landmarkDiagnostics.irisDiameterRatio.median',
  'landmarkDiagnostics.irisDiameterRatio.p99',
  'landmarkDiagnostics.irisWidthByRelativeOpenness[].relativeOpenness[]',
  'landmarkDiagnostics.irisWidthByRelativeOpenness[].frames',
  'landmarkDiagnostics.irisWidthByRelativeOpenness[].irisWidthChangePercent',
];
const PROVENANCE = ['clipSha256', 'size[]', 'fps', 'landmarksExtractedAtCommit', 'landmarksExtractedFromDirtyTree'];

/** Every field path a recorded clip may store, for a measured and for a failed aggregate. */
export const RECORDED_CLIP_FIELDS = {
  measured: [
    ...PROVENANCE,
    'ok',
    'frames',
    'acceptedFrames',
    ...REJECTIONS.map((reason) => `rejectedFrames.${reason}`),
    'nearPupillaryDistance.frameSdPercent',
    'nearPupillaryDistance.halfWidthPercent',
    'distancePupillaryDistance.halfWidthPercent',
    'faceWidth.frameSdPercent',
    'faceWidth.halfWidthPercent',
    ...DIAGNOSTICS,
  ].sort(),
  failed: [...PROVENANCE, 'ok', 'reason', 'frames', 'acceptedFrames', ...REJECTIONS.map((reason) => `rejectedFrames.${reason}`), ...DIAGNOSTICS].sort(),
};

/** Field paths present in a value, arrays written as []; leaves only. */
export function fieldPaths(value, prefix = '') {
  if (Array.isArray(value)) return [...new Set(value.flatMap((item) => fieldPaths(item, `${prefix}[]`)))];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => fieldPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

/** Throws unless the recorded clip stores exactly the allowed fields. */
export function assertRecordedClipFields(clip) {
  const allowed = clip.ok ? RECORDED_CLIP_FIELDS.measured : RECORDED_CLIP_FIELDS.failed;
  const present = [...new Set(fieldPaths(clip))].sort();
  const extra = present.filter((path) => !allowed.includes(path));
  const missing = allowed.filter((path) => !present.includes(path));
  if (extra.length || missing.length) throw new Error(`recorded clip fields differ from the allowed list: extra ${extra.join(', ') || 'none'}; missing ${missing.join(', ') || 'none'}`);
}

const RECORDINGS_FIELDS = [
  'privacy',
  'blinkAgainstStaticMedianChangePercent.nearPupillaryDistance',
  'blinkAgainstStaticMedianChangePercent.faceWidth',
  'landmarks.runtime',
  'landmarks.modelSha256',
  'landmarks.options.runningMode',
  'landmarks.options.numFaces',
  'landmarks.browser',
  'landmarks.blockedRequestCount',
].sort();

/** Throws unless a recordings entry stores exactly the allowed fields, clip by clip. */
export function assertRecordingsFields(recordings) {
  const { clips, ...rest } = recordings;
  if (!clips || !Object.keys(clips).length) throw new Error('recordings hold no clips');
  Object.values(clips).forEach(assertRecordedClipFields);
  const present = [...new Set(fieldPaths(rest))].sort();
  // Agreement is null when either clip failed; that leaf stands for both medians.
  const allowed = rest.blinkAgainstStaticMedianChangePercent === null
    ? RECORDINGS_FIELDS.filter((path) => !path.startsWith('blinkAgainstStatic')).concat('blinkAgainstStaticMedianChangePercent').sort()
    : RECORDINGS_FIELDS;
  if (JSON.stringify(present) !== JSON.stringify(allowed)) throw new Error(`recordings fields differ from the allowed list: ${present.join(', ')}`);
}
