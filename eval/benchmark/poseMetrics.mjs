// Error metrics for the head-pose benchmark. Angles are radians in, degrees out.
import { angleBetweenRotations } from '../../packages/cv/src/rotation.ts';
import { aflwRotation, equivalentAflwAngles } from './conventions.mjs';

const DEG = 180 / Math.PI;
const AXES = ['pitch', 'yaw', 'roll'];

/** The common AFLW2000 protocol drops samples with any label beyond 99 degrees. */
export const PROTOCOL_LIMIT_DEG = 99;
export const WITHIN_THRESHOLDS_DEG = [5, 10, 15];

export function withinProtocol(angles) {
  return AXES.every((axis) => Math.abs(angles[axis] * DEG) <= PROTOCOL_LIMIT_DEG);
}

/** Difference wrapped to (-180, 180] degrees. */
export function wrapDegrees(a) {
  const wrapped = a - 360 * Math.floor((a + 180) / 360);
  return wrapped === -180 ? 180 : wrapped;
}

const absoluteAxisErrors = (predicted, truth) =>
  Object.fromEntries(AXES.map((axis) => [axis, Math.abs(wrapDegrees((predicted[axis] - truth[axis]) * DEG))]));

const sumOf = (errors) => errors.pitch + errors.yaw + errors.roll;

/**
 * Per-axis absolute errors in degrees and the geodesic error. A rotation has
 * two angle triples; the one closer to the label is compared, so a label past
 * 90 degrees of yaw is not charged for a change of branch that leaves the
 * rotation the same.
 */
export function poseErrorsDeg(predicted, truth) {
  const principal = absoluteAxisErrors(predicted, truth);
  const alternate = absoluteAxisErrors(equivalentAflwAngles(predicted), truth);
  const axisErrors = sumOf(alternate) < sumOf(principal) ? alternate : principal;
  return { ...axisErrors, geodesic: angleBetweenRotations(aflwRotation(predicted), aflwRotation(truth)) * DEG };
}

/** Linear interpolation between order statistics, numpy's default. */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const mean = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);

/** Per-axis MAE, their mean, geodesic error statistics and the share of samples within each geodesic threshold. */
export function summarizePoseErrors(errors) {
  const maeDeg = Object.fromEntries(AXES.map((axis) => [axis, mean(errors.map((e) => e[axis]))]));
  maeDeg.mean = errors.length ? (maeDeg.pitch + maeDeg.yaw + maeDeg.roll) / 3 : null;
  const geodesic = errors.map((e) => e.geodesic);
  return {
    n: errors.length,
    maeDeg,
    geodesicDeg: { mean: mean(geodesic), median: percentile(geodesic, 0.5), p90: percentile(geodesic, 0.9) },
    shareWithinGeodesicDeg: Object.fromEntries(
      WITHIN_THRESHOLDS_DEG.map((t) => [t, errors.length ? geodesic.filter((g) => g <= t).length / errors.length : null]),
    ),
  };
}

/** Pearson correlation, used to check the sign of each axis mapping. */
export function correlation(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
