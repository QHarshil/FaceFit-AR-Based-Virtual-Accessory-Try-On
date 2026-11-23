import { describe, expect, it } from 'vitest';
import {
  estimateIntrinsics,
  projectPoint,
  projectionMatrixFromIntrinsics,
  type CameraIntrinsics,
} from '../src/camera.ts';
import type { Vec2, Vec3 } from '../src/linalg.ts';
import { seededRandom } from './random.ts';

function projectThroughGlMatrix(matrix: Float64Array, intrinsics: CameraIntrinsics, point: Vec3): Vec2 {
  // Solver camera (x right, y down, z forward) to GL eye space (y up, looking down -z).
  const eye = [point[0], -point[1], -point[2], 1];
  const clip = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) clip[row]! += matrix[col * 4 + row]! * eye[col]!;
  }
  const ndcX = clip[0]! / clip[3]!;
  const ndcY = clip[1]! / clip[3]!;
  return [((ndcX + 1) / 2) * intrinsics.width, ((1 - ndcY) / 2) * intrinsics.height];
}

describe('estimateIntrinsics', () => {
  it('derives focal length from horizontal FOV with the principal point at the centre', () => {
    const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 });
    expect(intrinsics).not.toBeNull();
    expect(intrinsics!.fx).toBeCloseTo(640 / Math.tan((31 * Math.PI) / 180), 12);
    expect(intrinsics!.fy).toBe(intrinsics!.fx);
    expect(intrinsics!.cx).toBe(640);
    expect(intrinsics!.cy).toBe(360);
  });

  it('maps the image edge to half the horizontal FOV', () => {
    const intrinsics = estimateIntrinsics({ width: 640, height: 480, horizontalFovDeg: 70 })!;
    const edge = projectPoint(intrinsics, [Math.tan((35 * Math.PI) / 180), 0, 1])!;
    expect(edge[0]).toBeCloseTo(640, 9);
  });

  it.each([
    { width: 0, height: 720, horizontalFovDeg: 62 },
    { width: 1280, height: -1, horizontalFovDeg: 62 },
    { width: Number.NaN, height: 720, horizontalFovDeg: 62 },
    { width: 1280, height: 720, horizontalFovDeg: 0 },
    { width: 1280, height: 720, horizontalFovDeg: 180 },
    { width: 1280, height: 720, horizontalFovDeg: Number.POSITIVE_INFINITY },
  ])('returns null for %o', (input) => {
    expect(estimateIntrinsics(input)).toBeNull();
  });
});

describe('projectPoint', () => {
  it('returns null at or behind the camera plane', () => {
    const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 })!;
    expect(projectPoint(intrinsics, [0, 0, 0])).toBeNull();
    expect(projectPoint(intrinsics, [10, 10, -500])).toBeNull();
    expect(projectPoint(intrinsics, [Number.NaN, 0, 500])).toBeNull();
  });
});

describe('projectionMatrixFromIntrinsics', () => {
  it('lands on the same pixel as projectPoint within 1e-9 px', () => {
    const random = seededRandom(1);
    for (let trial = 0; trial < 500; trial++) {
      const width = random.uniform(320, 3840);
      const height = random.uniform(240, 2160);
      const intrinsics: CameraIntrinsics = {
        fx: random.uniform(300, 3000),
        fy: random.uniform(300, 3000),
        cx: width * random.uniform(0.3, 0.7),
        cy: height * random.uniform(0.3, 0.7),
        width,
        height,
      };
      const matrix = projectionMatrixFromIntrinsics(intrinsics, 10, 5000)!;
      const point: Vec3 = [random.uniform(-800, 800), random.uniform(-800, 800), random.uniform(50, 4000)];
      const viaIntrinsics = projectPoint(intrinsics, point)!;
      const viaGl = projectThroughGlMatrix(matrix, intrinsics, point);
      expect(Math.abs(viaGl[0] - viaIntrinsics[0])).toBeLessThan(1e-9);
      expect(Math.abs(viaGl[1] - viaIntrinsics[1])).toBeLessThan(1e-9);
    }
  });

  it('maps the near and far planes to NDC depth -1 and 1', () => {
    const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 })!;
    const matrix = projectionMatrixFromIntrinsics(intrinsics, 20, 3000)!;
    const ndcDepth = (eyeZ: number): number => (matrix[10]! * eyeZ + matrix[14]!) / (matrix[11]! * eyeZ);
    expect(ndcDepth(-20)).toBeCloseTo(-1, 12);
    expect(ndcDepth(-3000)).toBeCloseTo(1, 12);
  });

  it('returns null for invalid intrinsics or clip planes', () => {
    const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 })!;
    expect(projectionMatrixFromIntrinsics({ ...intrinsics, width: 0 }, 10, 1000)).toBeNull();
    expect(projectionMatrixFromIntrinsics({ ...intrinsics, fx: Number.NaN }, 10, 1000)).toBeNull();
    expect(projectionMatrixFromIntrinsics(intrinsics, 0, 1000)).toBeNull();
    expect(projectionMatrixFromIntrinsics(intrinsics, 100, 100)).toBeNull();
    expect(projectionMatrixFromIntrinsics(intrinsics, 10, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
