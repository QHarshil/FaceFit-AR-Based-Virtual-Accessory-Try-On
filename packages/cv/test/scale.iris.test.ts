import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/linalg.ts';
import { fitIris, irisDiameterPx, type IrisPoints } from '../src/scale/iris.ts';
import { EYE_LANDMARKS, FACE_MESH_IRIS_LANDMARK_COUNT } from '../src/scale/landmarks.ts';
import { seededRandom } from './random.ts';

const DEG = Math.PI / 180;

/** Iris of horizontal radius a and vertical radius b at the centre, its horizontal axis at the angle. */
function ellipse(centre: Vec2, a: number, b: number, angleDeg: number): IrisPoints {
  const c = Math.cos(angleDeg * DEG);
  const s = Math.sin(angleDeg * DEG);
  const at = (u: number, v: number): Vec2 => [centre[0] + u * c - v * s, centre[1] + u * s + v * c];
  return { centre: at(0, 0), horizontal: [at(a, 0), at(-a, 0)], vertical: [at(0, -b), at(0, b)] };
}

function moved(points: IrisPoints, which: 'centre' | 'h0' | 'h1' | 'v0' | 'v1', offset: Vec2): IrisPoints {
  const shift = (p: Vec2): Vec2 => [p[0] + offset[0], p[1] + offset[1]];
  return {
    centre: which === 'centre' ? shift(points.centre) : points.centre,
    horizontal: [which === 'h0' ? shift(points.horizontal[0]) : points.horizontal[0], which === 'h1' ? shift(points.horizontal[1]) : points.horizontal[1]],
    vertical: [which === 'v0' ? shift(points.vertical[0]) : points.vertical[0], which === 'v1' ? shift(points.vertical[1]) : points.vertical[1]],
  };
}

const A = 14;
const B = 0.87 * A;
const AXIS_DEG = 20;
const AXIS: Vec2 = [Math.cos(AXIS_DEG * DEG), Math.sin(AXIS_DEG * DEG)];
const CLEAN = ellipse([400, 300], A, B, AXIS_DEG);
/** Median distance from the centre to the contour points: (a + b) / 2 for this layout. */
const RADIUS = (A + B) / 2;
const TOLERANCE = 0.2 * RADIUS;

describe('fitIris', () => {
  it('recovers the horizontal diameter and centre of an exact ellipse along a rolled axis', () => {
    const fit = fitIris(CLEAN, { axis: AXIS });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.horizontalDiameter).toBeCloseTo(2 * A, 10);
    expect(fit.centre[0]).toBeCloseTo(400, 10);
    expect(fit.centre[1]).toBeCloseTo(300, 10);
  });

  it('leaves the diameter and centre exact when the centre or one vertical point is far off', () => {
    const far = 0.5 * RADIUS;
    for (const which of ['centre', 'v0', 'v1'] as const) {
      for (const [u, v] of [[far, 0], [0, far], [-far, far]] as Vec2[]) {
        const offset: Vec2 = [u * AXIS[0] - v * AXIS[1], u * AXIS[1] + v * AXIS[0]];
        const fit = fitIris(moved(CLEAN, which, offset), { axis: AXIS });
        expect(fit.ok && fit.horizontalDiameter, `${which} ${offset}`).toBeCloseTo(2 * A, 10);
        if (!fit.ok) continue;
        expect(Math.hypot(fit.centre[0] - 400, fit.centre[1] - 300), `${which} ${offset}`).toBeLessThan(1e-9);
      }
    }
  });

  it('nulls the diameter when one horizontal point is off by more than twice the tolerance along the axis', () => {
    for (const which of ['h0', 'h1'] as const) {
      const offset: Vec2 = [2.2 * TOLERANCE * AXIS[0], 2.2 * TOLERANCE * AXIS[1]];
      const fit = fitIris(moved(CLEAN, which, offset), { axis: AXIS });
      expect(fit.ok && fit.horizontalDiameter).toBeNull();
    }
  });

  it('keeps the diameter and centre exact when a horizontal point is off across the axis', () => {
    const offset: Vec2 = [-1.2 * TOLERANCE * AXIS[1], 1.2 * TOLERANCE * AXIS[0]];
    const fit = fitIris(moved(CLEAN, 'h1', offset), { axis: AXIS });
    expect(fit.ok && fit.horizontalDiameter).toBeCloseTo(2 * A, 10);
    if (!fit.ok) return;
    expect(Math.hypot(fit.centre[0] - 400, fit.centre[1] - 300)).toBeLessThan(1e-9);
  });

  it('keeps an undetected horizontal error within twice the tolerance', () => {
    for (const fraction of [0.5, 1, 1.9]) {
      const offset: Vec2 = [fraction * TOLERANCE * AXIS[0], fraction * TOLERANCE * AXIS[1]];
      const fit = fitIris(moved(CLEAN, 'h0', offset), { axis: AXIS });
      expect(fit.ok).toBe(true);
      if (!fit.ok || fit.horizontalDiameter === null) continue;
      expect(Math.abs(fit.horizontalDiameter - 2 * A)).toBeLessThanOrEqual(2 * TOLERANCE + 1e-9);
    }
  });

  /*
   * At 1 px of noise per coordinate and a 14 px radius the tolerance is
   * 2.6 px. The midpoint test has SD of about sqrt(1/2 + 0.45) = 0.97 px
   * (a median of three has variance 0.45 sigma^2), so it trips 0.7% of the
   * time. Over 2,000 fits that count has SD 0.19%; the bound is 1.5%.
   */
  it('rarely rejects a clean iris at 1 px of noise', () => {
    const random = seededRandom(31);
    const jitter = (p: Vec2): Vec2 => [p[0] + random.gaussian(1), p[1] + random.gaussian(1)];
    let nulls = 0;
    const trials = 2000;
    for (let trial = 0; trial < trials; trial++) {
      const noisy: IrisPoints = {
        centre: jitter(CLEAN.centre),
        horizontal: [jitter(CLEAN.horizontal[0]), jitter(CLEAN.horizontal[1])],
        vertical: [jitter(CLEAN.vertical[0]), jitter(CLEAN.vertical[1])],
      };
      const fit = fitIris(noisy, { axis: AXIS });
      if (fit.ok && fit.horizontalDiameter === null) nulls++;
    }
    expect(nulls / trials).toBeLessThan(0.015);
  });

  it('fails on non-finite or coincident points', () => {
    expect(fitIris(moved(CLEAN, 'v0', [Number.NaN, 0]), { axis: AXIS })).toEqual({ ok: false, reason: 'non-finite-input' });
    const point: Vec2 = [1, 1];
    expect(fitIris({ centre: point, horizontal: [point, point], vertical: [point, point] })).toEqual({ ok: false, reason: 'degenerate' });
    expect(fitIris(CLEAN, { axis: [0, 0] })).toEqual({ ok: false, reason: 'degenerate' });
  });
});

describe('irisDiameterPx', () => {
  function landmarksWith(eye: 'right' | 'left', iris: IrisPoints, cornerAngleDeg: number): Vec2[] {
    const landmarks: Vec2[] = Array.from({ length: FACE_MESH_IRIS_LANDMARK_COUNT }, () => [0, 0]);
    const indices = EYE_LANDMARKS[eye];
    landmarks[indices.irisCentre] = iris.centre;
    landmarks[indices.irisHorizontal[0]] = iris.horizontal[0];
    landmarks[indices.irisHorizontal[1]] = iris.horizontal[1];
    landmarks[indices.irisVertical[0]] = iris.vertical[0];
    landmarks[indices.irisVertical[1]] = iris.vertical[1];
    const c = Math.cos(cornerAngleDeg * DEG);
    const s = Math.sin(cornerAngleDeg * DEG);
    landmarks[indices.corners[0]] = [iris.centre[0] - 30 * c, iris.centre[1] - 30 * s];
    landmarks[indices.corners[1]] = [iris.centre[0] + 30 * c, iris.centre[1] + 30 * s];
    return landmarks;
  }

  it('measures along the line through the eye corners', () => {
    for (const eye of ['right', 'left'] as const) {
      const measured = irisDiameterPx(landmarksWith(eye, CLEAN, AXIS_DEG), eye);
      expect(measured.ok && measured.diameterPx).toBeCloseTo(2 * A, 10);
    }
  });

  it('reports missing landmarks and an inconsistent contour', () => {
    expect(irisDiameterPx(landmarksWith('right', CLEAN, AXIS_DEG).slice(0, 468), 'right')).toEqual({ ok: false, reason: 'missing-landmarks' });
    const bad = moved(CLEAN, 'h0', [3 * TOLERANCE * AXIS[0], 3 * TOLERANCE * AXIS[1]]);
    expect(irisDiameterPx(landmarksWith('left', bad, AXIS_DEG), 'left')).toEqual({ ok: false, reason: 'inconsistent-contour' });
  });
});
