// Attacks on recorded clip fields: given only what a recorded clip stores,
// estimate the wearer's face scale and face width. The privacy tests run
// them on synthetic wearers, whose pipeline values are known, and require
// them to do no better than the iris population spread.
import {
  FOCAL_LENGTH_RELATIVE_SD,
  IRIS_PLANE_OFFSET_MM,
  IRIS_PLANE_OFFSET_SD_MM,
  POPULATION_IRIS_DIAMETER_MM,
  PUPIL_TO_ROTATION_CENTRE_MM,
  PUPIL_TO_ROTATION_CENTRE_SD_MM,
} from '../../packages/cv/src/index.ts';
import { canonicalPosition, EYE_LANDMARKS, FACE_WIDTH_LANDMARKS } from '../../packages/cv/src/scale/landmarks.ts';
import { FIXATION_DISTANCE_RELATIVE_SD } from '../../packages/cv/src/scale/measurements.ts';

const Z_95 = 1.959964;
const MEDIAN_SE_FACTOR = Math.sqrt(Math.PI / 2);
const RELATIVE_POPULATION_SD = POPULATION_IRIS_DIAMETER_MM.sd / POPULATION_IRIS_DIAMETER_MM.mean;

const mid = (a, b) => a.map((value, i) => (value + b[i]) / 2);
const eyePoint = (eye) => {
  const [a, b] = EYE_LANDMARKS[eye].corners.map(canonicalPosition);
  const m = mid(a, b);
  return [m[0], m[1], m[2] - IRIS_PLANE_OFFSET_MM];
};
const [WIDTH_A, WIDTH_B] = FACE_WIDTH_LANDMARKS.map(canonicalPosition);
/** Canonical depth of the face-width landmarks behind the eye points, and the canonical face width. */
const WIDTH_BEHIND_EYES_MM = mid(WIDTH_A, WIDTH_B)[2] - mid(eyePoint('right'), eyePoint('left'))[2];
export const CANONICAL_FACE_WIDTH_MM = Math.abs(WIDTH_B[0] - WIDTH_A[0]);

const PRIOR = { faceScale: 1, faceWidthMm: CANONICAL_FACE_WIDTH_MM };

/**
 * Inverts the interval model. The distance-PD model SD over the value is
 * hypot(lever SD, 0.2 lever) / (F - lever), which gives the fixation
 * distance F; the face-width model SD over the value is
 * hypot(0.15 e, 3 mm / F) with elasticity e = d / (z + d), d the canonical
 * depth of the width landmarks behind the eyes and z the canonical eye
 * depth, which gives z; the face scale is F / z. A model SD is read
 * directly when stored, or from the half-width less the population and
 * noise terms. Anything that does not invert falls back to the canonical
 * face.
 */
export function invertIntervalModel(record) {
  if (!record.ok) return PRIOR;
  const modelSd = (interval, frameSdPercent) => {
    if (typeof interval.modelSdPercent === 'number') return interval.modelSdPercent / 100;
    const total = interval.halfWidthPercent / 100 / Z_95;
    const noise = (MEDIAN_SE_FACTOR * frameSdPercent) / 100 / Math.sqrt(record.acceptedFrames);
    const square = total ** 2 - RELATIVE_POPULATION_SD ** 2 - noise ** 2;
    return square > 0 ? Math.sqrt(square) : null;
  };
  const distance = modelSd(record.distancePupillaryDistance, record.distancePupillaryDistance.frameSdPercent ?? record.nearPupillaryDistance.frameSdPercent);
  const width = modelSd(record.faceWidth, record.faceWidth.frameSdPercent);
  if (!distance || !width) return PRIOR;
  const lever = PUPIL_TO_ROTATION_CENTRE_MM;
  const fixationMm = Math.hypot(PUPIL_TO_ROTATION_CENTRE_SD_MM, FIXATION_DISTANCE_RELATIVE_SD * lever) / distance + lever;
  const elasticitySquare = width ** 2 - (IRIS_PLANE_OFFSET_SD_MM / fixationMm) ** 2;
  if (!(elasticitySquare > 0)) return PRIOR;
  const elasticity = Math.sqrt(elasticitySquare) / FOCAL_LENGTH_RELATIVE_SD;
  const canonicalEyeDepthMm = (WIDTH_BEHIND_EYES_MM * (1 - elasticity)) / elasticity;
  const faceScale = fixationMm / canonicalEyeDepthMm;
  return faceScale > 0 && Number.isFinite(faceScale) ? { faceScale, faceWidthMm: faceScale * CANONICAL_FACE_WIDTH_MM } : PRIOR;
}

/** Every number in a record, in a fixed order. */
export function recordFeatures(record) {
  const out = [];
  const walk = (value) => {
    if (typeof value === 'number') out.push(value);
    else if (typeof value === 'boolean') out.push(value ? 1 : 0);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.keys(value).sort().forEach((key) => walk(value[key]));
  };
  walk(record);
  return out;
}

/**
 * Ridge regression of the log target on the standardized features of the
 * training records, as an attacker with unlimited synthetic data could fit.
 * Returns a predictor for new records.
 */
export function fitRegressionAttack(records, targets, ridge = 1e-3) {
  const rows = records.map(recordFeatures);
  const width = rows[0].length;
  const means = Array.from({ length: width }, (_, j) => rows.reduce((sum, row) => sum + row[j], 0) / rows.length);
  const sds = means.map((mean, j) => Math.sqrt(rows.reduce((sum, row) => sum + (row[j] - mean) ** 2, 0) / rows.length));
  const keep = sds.map((sd, j) => j).filter((j) => sds[j] > 1e-12);
  const design = (row) => [1, ...keep.map((j) => (row[j] - means[j]) / sds[j])];
  const x = rows.map(design);
  const y = targets.map(Math.log);
  const k = x[0].length;
  const normal = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => x.reduce((sum, row) => sum + row[a] * row[b], 0) + (a === b && a > 0 ? ridge * x.length : 0)));
  const rhs = Array.from({ length: k }, (_, a) => x.reduce((sum, row, i) => sum + row[a] * y[i], 0));
  const beta = solveLinear(normal, rhs);
  return (record) => Math.exp(design(recordFeatures(record)).reduce((sum, value, j) => sum + value * beta[j], 0));
}

function solveLinear(matrix, rhs) {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let c = col; c <= n; c++) a[row][c] -= factor * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

/** Root mean square of ln(estimate / actual). */
export function rmsLogError(estimates, actuals) {
  return Math.sqrt(estimates.reduce((sum, estimate, i) => sum + Math.log(estimate / actuals[i]) ** 2, 0) / estimates.length);
}
