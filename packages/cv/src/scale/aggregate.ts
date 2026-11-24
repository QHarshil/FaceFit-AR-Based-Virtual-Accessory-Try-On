import { IRIS_ASYMMETRY_TOLERANCE, POPULATION_IRIS_DIAMETER_MM } from './faceScale.ts';
import type { FaceFrame, FaceFrameFailureReason, FaceFrameResult } from './frame.ts';
import { median } from './iris.ts';

export interface FaceMeasurementLimits {
  /**
   * Largest angle between the head's forward axis and the line of sight to
   * the camera. If the eyes follow the head instead of fixating the camera,
   * PD and face width read 1 / cos of it too large: 1.5% at 10 degrees.
   */
  readonly maxYawDeg: number;
  /** Vertical counterpart. Pitch foreshortens the vertical iris axis, which the scale does not use, so the limit is looser. */
  readonly maxPitchDeg: number;
  /** The app's threshold for showing the overlay. */
  readonly maxRmsReprojectionMm: number;
  /** Rotation noise above this makes the yaw and pitch gates themselves unreliable. */
  readonly maxRotationStdDeg: number;
  /**
   * Plausible face scale. The canonical eye spacing is 63 mm, the adult mean
   * PD, so the face scale is about PD over 63 mm times the assumed over the
   * true iris diameter. PD from 41 mm (young children) to 78 mm (largest
   * adults) and an iris from 10.2 to 13.2 mm (3 SD) give 0.58 to 1.42; a
   * frame outside 0.55 to 1.45 has an iris fit that cannot be this face's.
   */
  readonly minFaceScale: number;
  readonly maxFaceScale: number;
  /** Absolute floor on eye openness, for clips where most frames are blinks. */
  readonly minEyeOpenness: number;
  /**
   * Openness relative to the median over the frames that pass the pose
   * gates. MediaPipe's iris contour narrows as the lids close;
   * irisWidthByRelativeOpenness in eval/results.json shows how narrow it
   * reads on the recordings below and above this floor.
   */
  readonly minRelativeEyeOpenness: number;
  /**
   * Largest relative difference between the eyes' iris diameters in a frame.
   * When the clip's own ratios scatter more, the gate widens to three of
   * their robust SDs, so noise alone does not reject frames; the clip then
   * fails if its median ratio is further from 1 than this plus three
   * standard errors, or if most frames are gated.
   */
  readonly maxIrisAsymmetry: number;
  readonly minAcceptedFrames: number;
  /** Assumed population of horizontal iris diameters, mean and SD in mm. */
  readonly irisDiameterMm: number;
  readonly irisDiameterSdMm: number;
}

export const DEFAULT_FACE_MEASUREMENT_LIMITS: FaceMeasurementLimits = {
  maxYawDeg: 10,
  maxPitchDeg: 20,
  maxRmsReprojectionMm: 5,
  maxRotationStdDeg: 2,
  minFaceScale: 0.55,
  maxFaceScale: 1.45,
  minEyeOpenness: 0.15,
  minRelativeEyeOpenness: 0.9,
  maxIrisAsymmetry: IRIS_ASYMMETRY_TOLERANCE,
  minAcceptedFrames: 10,
  irisDiameterMm: POPULATION_IRIS_DIAMETER_MM.mean,
  irisDiameterSdMm: POPULATION_IRIS_DIAMETER_MM.sd,
};

export type FrameRejection =
  | 'no-face'
  | 'pose-failed'
  | 'measurement-failed'
  | 'iris-outside-eye'
  | 'untrusted-pose'
  | 'off-axis'
  | 'implausible-scale'
  | 'eyes-closed'
  | 'asymmetric-iris';

/** Median over accepted frames with a 95% interval. */
export interface MeasurementInterval {
  readonly medianMm: number;
  readonly lowerMm: number;
  readonly upperMm: number;
  /** SD across accepted frames. */
  readonly frameSdMm: number;
  /** Standard error of the median from frameSdMm and effectiveFrames. */
  readonly noiseSdMm: number;
  /** SD from the spread of iris sizes: medianMm times irisDiameterSdMm over irisDiameterMm. */
  readonly populationSdMm: number;
  /** SD of the modelled assumptions: the near-to-distance conversion for PD, focal length and iris plane for face width. */
  readonly modelSdMm: number;
  /** Accepted frames discounted for lag-1 autocorrelation. */
  readonly effectiveFrames: number;
}

export interface FaceMeasurementSummary {
  readonly ok: true;
  readonly acceptedFrames: number;
  readonly rejectedFrames: Readonly<Record<FrameRejection, number>>;
  readonly nearPupillaryDistance: MeasurementInterval;
  readonly distancePupillaryDistance: MeasurementInterval;
  readonly faceWidth: MeasurementInterval;
  /** Median and frame SD of the face scale. Its population spread is the same relative spread as the intervals'. */
  readonly faceScale: { readonly median: number; readonly frameSd: number };
}

export interface FaceMeasurementFailure {
  readonly ok: false;
  readonly reason: 'too-few-frames' | 'asymmetric-iris' | 'invalid-limits';
  readonly acceptedFrames: number;
  readonly rejectedFrames: Readonly<Record<FrameRejection, number>>;
}

export type FaceMeasurementResult = FaceMeasurementSummary | FaceMeasurementFailure;

/** Two-sided 95% normal quantile. */
const Z_95 = 1.959964;
/** Large-sample SE of a normal sample's median over that of its mean, sqrt(pi / 2). */
const MEDIAN_SE_FACTOR = Math.sqrt(Math.PI / 2);
/** Cap on the lag-1 autocorrelation so a nearly constant sequence keeps a positive effective count. */
const MAX_AUTOCORRELATION = 0.95;

const FAILURE_REJECTION: Record<FaceFrameFailureReason, FrameRejection> = {
  'no-face': 'no-face',
  'pose-failed': 'pose-failed',
  'missing-landmarks': 'measurement-failed',
  'iris-outside-eye': 'iris-outside-eye',
  'measurement-failed': 'measurement-failed',
};

/**
 * Combines frames, in capture order, into medians with 95% intervals.
 * Frames are accepted when measured, when the pose is trusted (reprojection
 * RMS and rotation SD), when the face is near frontal, when the face scale
 * is plausible, when the eyes are open, and when the two irises agree in
 * size; each rejection counts under the first check it fails.
 *
 * The interval's half-width is 1.96 sqrt(population^2 + noise^2 + model^2).
 * The population term is the iris-size spread: every frame shares the
 * wearer's iris, so averaging cannot shrink it. The noise term is the
 * standard error of the median, sqrt(pi / 2) SD / sqrt(n_eff), with
 * n_eff = n (1 - rho) / (1 + rho) for lag-1 autocorrelation rho, because
 * consecutive video frames are not independent.
 */
export function aggregateFaceMeasurements(
  frames: readonly FaceFrameResult[],
  limits: Partial<FaceMeasurementLimits> = {},
): FaceMeasurementResult {
  const settings: FaceMeasurementLimits = { ...DEFAULT_FACE_MEASUREMENT_LIMITS, ...limits };
  const rejectedFrames: Record<FrameRejection, number> = {
    'no-face': 0,
    'pose-failed': 0,
    'measurement-failed': 0,
    'iris-outside-eye': 0,
    'untrusted-pose': 0,
    'off-axis': 0,
    'implausible-scale': 0,
    'eyes-closed': 0,
    'asymmetric-iris': 0,
  };
  if (!validLimits(settings)) return { ok: false, reason: 'invalid-limits', acceptedFrames: 0, rejectedFrames };

  const posed: FaceFrame[] = [];
  for (const frame of frames) {
    if (!frame.ok) {
      rejectedFrames[FAILURE_REJECTION[frame.reason] ?? 'measurement-failed']++;
    } else if (!hasUsableMeasurements(frame)) {
      rejectedFrames['measurement-failed']++;
    } else if (
      !(frame.rmsReprojectionMm <= settings.maxRmsReprojectionMm) ||
      frame.maxRotationStdDeg === null ||
      !(frame.maxRotationStdDeg <= settings.maxRotationStdDeg)
    ) {
      rejectedFrames['untrusted-pose']++;
    } else if (!(Math.abs(frame.lineOfSightYawDeg) <= settings.maxYawDeg && Math.abs(frame.lineOfSightPitchDeg) <= settings.maxPitchDeg)) {
      rejectedFrames['off-axis']++;
    } else if (!(frame.faceScale >= settings.minFaceScale && frame.faceScale <= settings.maxFaceScale)) {
      rejectedFrames['implausible-scale']++;
    } else {
      posed.push(frame);
    }
  }
  const opennessFloor = posed.length
    ? Math.max(settings.minEyeOpenness, settings.minRelativeEyeOpenness * median(posed.map((frame) => frame.eyeOpenness)))
    : settings.minEyeOpenness;
  const open = posed.filter((frame) => frame.eyeOpenness >= opennessFloor);
  rejectedFrames['eyes-closed'] += posed.length - open.length;

  const asymmetry = irisAsymmetryGate(open, settings.maxIrisAsymmetry);
  const accepted = open.filter((frame) => asymmetry.accepts(frame));
  rejectedFrames['asymmetric-iris'] += open.length - accepted.length;
  if (open.length && (asymmetry.clipAsymmetric || 2 * accepted.length < open.length)) {
    return { ok: false, reason: 'asymmetric-iris', acceptedFrames: accepted.length, rejectedFrames };
  }
  if (accepted.length < settings.minAcceptedFrames) {
    return { ok: false, reason: 'too-few-frames', acceptedFrames: accepted.length, rejectedFrames };
  }
  const relativePopulationSd = settings.irisDiameterSdMm / settings.irisDiameterMm;
  const conversionSd = median(accepted.map((frame) => frame.distancePdCorrectionSdMm));
  const scales = accepted.map((frame) => frame.faceScale);
  return {
    ok: true,
    acceptedFrames: accepted.length,
    rejectedFrames,
    nearPupillaryDistance: interval(accepted.map((frame) => frame.nearPdMm), relativePopulationSd, 0),
    distancePupillaryDistance: interval(accepted.map((frame) => frame.distancePdMm), relativePopulationSd, conversionSd),
    faceWidth: interval(
      accepted.map((frame) => frame.faceWidthMm),
      relativePopulationSd,
      median(accepted.map((frame) => frame.faceWidthModelSdMm)),
    ),
    faceScale: { median: median(scales), frameSd: standardDeviation(scales) },
  };
}

/**
 * Gate on the log ratio of the eyes' iris diameters. Frames measured from
 * one eye have no ratio and pass. The frame tolerance is the larger of the
 * stated one and three robust SDs (1.4826 MAD) of the clip's log ratios; the
 * clip is asymmetric when the median log ratio is beyond the stated
 * tolerance plus three standard errors of the median and most frames carry
 * a ratio, which catches a constant fault that per-frame noise would hide.
 */
function irisAsymmetryGate(frames: readonly FaceFrame[], maxIrisAsymmetry: number) {
  const logRatios = frames.flatMap((frame) => (frame.irisDiameterRatio === null ? [] : [Math.log(frame.irisDiameterRatio)]));
  const stated = Math.log(1 + maxIrisAsymmetry);
  if (!logRatios.length) return { accepts: () => true, clipAsymmetric: false };
  const centre = median(logRatios);
  const robustSd = 1.4826 * median(logRatios.map((value) => Math.abs(value - centre)));
  const frameTolerance = Math.max(stated, 3 * robustSd);
  const medianSe = (MEDIAN_SE_FACTOR * robustSd) / Math.sqrt(logRatios.length);
  return {
    accepts: (frame: FaceFrame) => frame.irisDiameterRatio === null || Math.abs(Math.log(frame.irisDiameterRatio)) <= frameTolerance,
    clipAsymmetric: 2 * logRatios.length > frames.length && Math.abs(centre) > stated + 3 * medianSe,
  };
}

/** measureFaceFrame never returns these, but frames can come from anywhere, and one NaN would poison every median and interval. */
function hasUsableMeasurements(frame: FaceFrame): boolean {
  const positive = [frame.faceScale, frame.irisDepthMm, frame.nearPdMm, frame.distancePdMm, frame.faceWidthMm];
  const nonNegative = [frame.distancePdCorrectionSdMm, frame.faceWidthModelSdMm, frame.eyeOpenness];
  const ratio = frame.irisDiameterRatio;
  return (
    (ratio === null || (Number.isFinite(ratio) && ratio > 0)) &&
    positive.every((value) => Number.isFinite(value) && value > 0) &&
    nonNegative.every((value) => Number.isFinite(value) && value >= 0) &&
    Number.isFinite(frame.lineOfSightYawDeg) &&
    Number.isFinite(frame.lineOfSightPitchDeg)
  );
}

function interval(values: readonly number[], relativePopulationSd: number, modelSdMm: number): MeasurementInterval {
  const medianMm = median(values);
  const frameSdMm = standardDeviation(values);
  const rho = Math.min(Math.max(lagOneAutocorrelation(values), 0), MAX_AUTOCORRELATION);
  const effectiveFrames = Math.max(1, (values.length * (1 - rho)) / (1 + rho));
  const noiseSdMm = (MEDIAN_SE_FACTOR * frameSdMm) / Math.sqrt(effectiveFrames);
  const populationSdMm = medianMm * relativePopulationSd;
  const halfWidth = Z_95 * Math.sqrt(populationSdMm ** 2 + noiseSdMm ** 2 + modelSdMm ** 2);
  return {
    medianMm,
    lowerMm: medianMm - halfWidth,
    upperMm: medianMm + halfWidth,
    frameSdMm,
    noiseSdMm,
    populationSdMm,
    modelSdMm,
    effectiveFrames,
  };
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

/** Lag-1 sample autocorrelation; 0 for fewer than three values or a constant sequence. */
function lagOneAutocorrelation(values: readonly number[]): number {
  if (values.length < 3) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i++) {
    const deviation = values[i]! - mean;
    denominator += deviation * deviation;
    if (i > 0) numerator += deviation * (values[i - 1]! - mean);
  }
  return denominator > 0 ? numerator / denominator : 0;
}

function validLimits(limits: FaceMeasurementLimits): boolean {
  const positive = [limits.maxYawDeg, limits.maxPitchDeg, limits.maxRmsReprojectionMm, limits.maxRotationStdDeg, limits.irisDiameterMm, limits.minFaceScale];
  const nonNegative = [limits.minEyeOpenness, limits.minRelativeEyeOpenness, limits.irisDiameterSdMm, limits.maxIrisAsymmetry];
  return (
    positive.every((value) => Number.isFinite(value) && value > 0) &&
    nonNegative.every((value) => Number.isFinite(value) && value >= 0) &&
    limits.maxFaceScale > limits.minFaceScale &&
    Number.isInteger(limits.minAcceptedFrames) &&
    limits.minAcceptedFrames >= 2
  );
}
