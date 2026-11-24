import type { Vec2 } from '../linalg.ts';
import { EYE_LANDMARKS, FACE_MESH_IRIS_LANDMARK_COUNT, type Eye } from './landmarks.ts';

/** The five iris landmarks of one eye, in any planar coordinates. */
export interface IrisPoints {
  readonly centre: Vec2;
  readonly horizontal: readonly [Vec2, Vec2];
  readonly vertical: readonly [Vec2, Vec2];
}

export interface IrisFitOptions {
  /**
   * A centre estimate, or the horizontal pair's midpoint, counts as
   * inconsistent when it is further than the tolerance from the median
   * centre: this fraction of the iris radius, but at least minTolerancePx.
   */
  readonly toleranceFraction?: number;
  readonly minTolerancePx?: number;
}

/** How the points relate to the image. */
export interface IrisFitFrame {
  /** The eye's horizontal direction in the points' coordinates. */
  readonly axis?: Vec2;
  /** Size of one image pixel in the points' units, to apply minTolerancePx. */
  readonly unitsPerPixel?: number;
}

export interface IrisFit {
  readonly ok: true;
  /**
   * Distance between the horizontal contour points along the axis. Null when
   * the pair disagrees with the centre: one of the two is wrong, and nothing
   * tells which.
   */
  readonly horizontalDiameter: number | null;
  /** Mean of the centre estimates that agree with the median centre. */
  readonly centre: Vec2;
}

export type IrisFitFailureReason = 'non-finite-input' | 'degenerate';

export type IrisFitResult = IrisFit | { readonly ok: false; readonly reason: IrisFitFailureReason };

/**
 * A fifth of the radius, about 2.6 px at 50 cm on a 720p webcam: 2.7 times
 * the SD of the midpoint test at 1 px of landmark noise. The 2 px floor keeps
 * a distant iris, 7 px in radius at 90 cm, from tripping at that noise.
 */
const DEFAULT_TOLERANCE_FRACTION = 0.2;
const DEFAULT_MIN_TOLERANCE_PX = 2;

/**
 * Fits the horizontal diameter and centre of an iris whose contour is an
 * ellipse aligned with the axis. The horizontal diameter is the gap between
 * the horizontal pair, because the population figure (11.7 mm) is a
 * horizontal diameter and MediaPipe's vertical pair is shorter.
 *
 * The centre's coordinate along the axis is estimated three ways that do not
 * involve the horizontal pair (the centre landmark and each vertical point),
 * and its other coordinate three ways that do not involve the vertical pair
 * (the centre and each horizontal point). Medians of three survive one bad
 * point. The horizontal pair is accepted only when its midpoint agrees with
 * that centre along the axis within the tolerance, so one bad point either
 * leaves the diameter untouched (a bad centre or vertical point, or a
 * horizontal point moved across the axis), moves it by at most twice the
 * tolerance, or nulls it. The centre is the mean of the estimates that
 * agree with the medians.
 */
export function fitIris(points: IrisPoints, frame: IrisFitFrame = {}, options: IrisFitOptions = {}): IrisFitResult {
  const axis = frame.axis ?? [1, 0];
  const unitsPerPixel = frame.unitsPerPixel ?? 1;
  const toleranceFraction = options.toleranceFraction ?? DEFAULT_TOLERANCE_FRACTION;
  const minTolerancePx = options.minTolerancePx ?? DEFAULT_MIN_TOLERANCE_PX;
  const all = [points.centre, ...points.horizontal, ...points.vertical];
  if (!all.every((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])) || !axis.every(Number.isFinite)) {
    return { ok: false, reason: 'non-finite-input' };
  }
  const axisLength = Math.hypot(axis[0], axis[1]);
  const settings = [toleranceFraction, minTolerancePx, unitsPerPixel];
  if (!(axisLength > 0) || !settings.every((value) => Number.isFinite(value) && value >= 0)) return { ok: false, reason: 'degenerate' };
  const ax = axis[0] / axisLength;
  const ay = axis[1] / axisLength;
  // (u, v): u along the axis, v along the axis turned a quarter clockwise on screen.
  const toAxis = (p: Vec2): Vec2 => [p[0] * ax + p[1] * ay, -p[0] * ay + p[1] * ax];

  const centre = toAxis(points.centre);
  const [left, right] = points.horizontal.map(toAxis).sort((a, b) => a[0] - b[0]) as [Vec2, Vec2];
  const [upper, lower] = points.vertical.map(toAxis).sort((a, b) => a[1] - b[1]) as [Vec2, Vec2];

  const radius = median([left, right, upper, lower].map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1])));
  if (!(radius > 0) || !(right[0] > left[0])) return { ok: false, reason: 'degenerate' };
  const tolerance = Math.max(toleranceFraction * radius, minTolerancePx * unitsPerPixel);

  const medianU = median([centre[0], upper[0], lower[0]]);
  const medianV = median([centre[1], left[1], right[1]]);
  const horizontalMidpoint = 0.5 * (left[0] + right[0]);
  const horizontalConsistent = Math.abs(horizontalMidpoint - medianU) <= tolerance;
  const u0 = meanWithin([centre[0], upper[0], lower[0], horizontalMidpoint], medianU, tolerance);
  const v0 = meanWithin([centre[1], left[1], right[1], 0.5 * (upper[1] + lower[1])], medianV, tolerance);
  return {
    ok: true,
    horizontalDiameter: horizontalConsistent ? right[0] - left[0] : null,
    centre: [u0 * ax - v0 * ay, u0 * ay + v0 * ax],
  };
}

export type IrisDiameterFailureReason = 'missing-landmarks' | IrisFitFailureReason | 'inconsistent-contour';

export type IrisDiameterResult =
  | { readonly ok: true; readonly diameterPx: number; readonly centrePx: Vec2 }
  | { readonly ok: false; readonly reason: IrisDiameterFailureReason };

/**
 * Horizontal iris diameter of one eye in pixels, along the line through the
 * eye corners. Not corrected for foreshortening; estimateFaceScale does that
 * from the pose. landmarksPx holds the 478 Face Mesh landmarks in pixels.
 */
export function irisDiameterPx(landmarksPx: readonly Vec2[], eye: Eye, options: IrisFitOptions = {}): IrisDiameterResult {
  if (!Array.isArray(landmarksPx) || landmarksPx.length < FACE_MESH_IRIS_LANDMARK_COUNT) return { ok: false, reason: 'missing-landmarks' };
  const indices = EYE_LANDMARKS[eye];
  const at = (index: number): Vec2 | undefined => landmarksPx[index];
  const needed = [indices.irisCentre, ...indices.irisHorizontal, ...indices.irisVertical, ...indices.corners].map(at);
  if (!needed.every((point) => Array.isArray(point) && point.length >= 2)) return { ok: false, reason: 'missing-landmarks' };
  const [first, second] = indices.corners.map((index) => at(index)!) as [Vec2, Vec2];
  const fit = fitIris(
    {
      centre: at(indices.irisCentre)!,
      horizontal: [at(indices.irisHorizontal[0])!, at(indices.irisHorizontal[1])!],
      vertical: [at(indices.irisVertical[0])!, at(indices.irisVertical[1])!],
    },
    { axis: [second[0] - first[0], second[1] - first[1]] },
    options,
  );
  if (!fit.ok) return fit;
  if (fit.horizontalDiameter === null) return { ok: false, reason: 'inconsistent-contour' };
  return { ok: true, diameterPx: fit.horizontalDiameter, centrePx: fit.centre };
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : 0.5 * (sorted[mid - 1]! + sorted[mid]!);
}

/** Mean of the values within tolerance of the reference; the reference itself when none are. */
function meanWithin(values: readonly number[], reference: number, tolerance: number): number {
  const kept = values.filter((value) => Math.abs(value - reference) <= tolerance);
  return kept.length ? kept.reduce((sum, value) => sum + value, 0) / kept.length : reference;
}
