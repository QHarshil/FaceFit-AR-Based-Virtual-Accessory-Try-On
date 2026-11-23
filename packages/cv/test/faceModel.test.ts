import { describe, expect, it } from 'vitest';
import { CANONICAL_PROCRUSTES_LANDMARKS } from '../src/canonicalFaceModel.ts';
import { RIGID_FACE_LANDMARKS, RIGID_FACE_LANDMARK_INDICES } from '../src/faceModel.ts';

function landmark(index: number) {
  const found = RIGID_FACE_LANDMARKS.find((entry) => entry.landmarkIndex === index);
  if (!found) throw new Error(`landmark ${index} missing`);
  return found;
}

describe('rigid face model', () => {
  it('keeps the 33 Procrustes landmarks with unique indices', () => {
    expect(RIGID_FACE_LANDMARKS).toHaveLength(33);
    expect(new Set(RIGID_FACE_LANDMARK_INDICES).size).toBe(33);
  });

  it('has positive weights that sum to 1', () => {
    const total = RIGID_FACE_LANDMARKS.reduce((sum, entry) => sum + entry.weight, 0);
    expect(total).toBeCloseTo(1, 14);
    for (const entry of RIGID_FACE_LANDMARKS) expect(entry.weight).toBeGreaterThan(0);
  });

  it('is in millimetres: outer eye corners about 89 mm apart', () => {
    const right = landmark(33).positionMm;
    const left = landmark(263).positionMm;
    const width = Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
    expect(width).toBeGreaterThan(80);
    expect(width).toBeLessThan(100);
  });

  it('uses the solver frame: x toward image right, y down, z away from the camera', () => {
    // Landmark 33 is the subject's right outer eye corner, seen on the image left.
    expect(landmark(33).positionMm[0]).toBeLessThan(0);
    expect(landmark(263).positionMm[0]).toBeGreaterThan(0);
    // Forehead (10) sits above the nose tip (4), so its y is smaller.
    expect(landmark(10).positionMm[1]).toBeLessThan(landmark(4).positionMm[1]);
    // The nose tip is the closest landmark to the camera.
    const minZ = Math.min(...RIGID_FACE_LANDMARKS.map((entry) => entry.positionMm[2]));
    expect(landmark(4).positionMm[2]).toBe(minZ);
  });

  it('is mirror symmetric with equal weights on mirrored pairs', () => {
    for (const entry of RIGID_FACE_LANDMARKS) {
      const [x, y, z] = entry.positionMm;
      const mirror = RIGID_FACE_LANDMARKS.find(
        (other) =>
          Math.abs(other.positionMm[0] + x) < 1e-9 &&
          Math.abs(other.positionMm[1] - y) < 1e-9 &&
          Math.abs(other.positionMm[2] - z) < 1e-9,
      );
      expect(mirror, `mirror of ${entry.landmarkIndex}`).toBeDefined();
      expect(mirror!.weight).toBeCloseTo(entry.weight, 12);
    }
  });

  it('downweights blink-affected landmarks relative to Google weights', () => {
    const procrustes = new Map(CANONICAL_PROCRUSTES_LANDMARKS.map((entry) => [entry.landmarkIndex, entry.procrustesWeight]));
    const ratio = (index: number): number => landmark(index).weight / procrustes.get(index)!;
    const unaffected = ratio(129);
    expect(ratio(4) / unaffected).toBeCloseTo(1, 12);
    expect(ratio(133) / unaffected).toBeCloseTo(1.2 / 3.2, 12);
    expect(ratio(6) / unaffected).toBeCloseTo(1.2 / 3.2, 12);
    expect(ratio(10) / unaffected).toBeCloseTo(1.2 / 7.2, 12);
    expect(ratio(297) / unaffected).toBeCloseTo(1.2 / 7.2, 12);
    expect(ratio(263) / unaffected).toBeCloseTo(1.2 / 8.4, 12);
  });
});
