import type { Vec2, Vec3 } from './linalg.ts';

/**
 * Pinhole intrinsics in pixels. Pixel coordinates put (0, 0) at the top-left
 * corner of the top-left pixel, x right and y down, so a landmark normalized to
 * [0, 1] maps to pixels by multiplying with width and height.
 */
export interface CameraIntrinsics {
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
}

export interface IntrinsicsFromFovInput {
  readonly width: number;
  readonly height: number;
  readonly horizontalFovDeg: number;
}

/**
 * Intrinsics for an uncalibrated camera from its horizontal field of view,
 * assuming square pixels and the principal point at the image centre.
 * Returns null for a non-positive size or a FOV outside (0, 180) degrees.
 */
export function estimateIntrinsics(input: IntrinsicsFromFovInput): CameraIntrinsics | null {
  const { width, height, horizontalFovDeg } = input;
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) return null;
  if (!(horizontalFovDeg > 0 && horizontalFovDeg < 180)) return null;
  const fx = width / 2 / Math.tan((horizontalFovDeg * Math.PI) / 360);
  return { fx, fy: fx, cx: width / 2, cy: height / 2, width, height };
}

export function isValidIntrinsics(intrinsics: CameraIntrinsics): boolean {
  const { fx, fy, cx, cy, width, height } = intrinsics;
  return (
    isPositiveFinite(fx) &&
    isPositiveFinite(fy) &&
    isPositiveFinite(width) &&
    isPositiveFinite(height) &&
    Number.isFinite(cx) &&
    Number.isFinite(cy)
  );
}

/**
 * Projects a point in camera coordinates (x right, y down, z forward, as used
 * by the PnP solver) to pixels. Returns null for points at or behind the
 * camera plane.
 */
export function projectPoint(intrinsics: CameraIntrinsics, pointCamera: Vec3): Vec2 | null {
  const [x, y, z] = pointCamera;
  if (!(z > 0) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [intrinsics.fx * (x / z) + intrinsics.cx, intrinsics.fy * (y / z) + intrinsics.cy];
}

/**
 * Column-major 4x4 projection for an OpenGL-convention renderer whose eye
 * space has x right, y up and the camera looking down -z. A point in solver
 * camera coordinates (x, y, z) is (x, -y, -z) in eye space. NDC y points up
 * while pixel y points down, so the matrix maps pixel v to NDC 1 - 2v/height.
 * The principal-point terms in the third column shift the image centre to
 * (cx, cy). Returns null for invalid intrinsics or clip planes.
 */
export function projectionMatrixFromIntrinsics(
  intrinsics: CameraIntrinsics,
  near: number,
  far: number,
): Float64Array | null {
  if (!isValidIntrinsics(intrinsics)) return null;
  if (!isPositiveFinite(near) || !Number.isFinite(far) || !(far > near)) return null;
  const { fx, fy, cx, cy, width, height } = intrinsics;
  const m = new Float64Array(16);
  m[0] = (2 * fx) / width;
  m[5] = (2 * fy) / height;
  m[8] = 1 - (2 * cx) / width;
  m[9] = (2 * cy) / height - 1;
  m[10] = -(far + near) / (far - near);
  m[11] = -1;
  m[14] = (-2 * far * near) / (far - near);
  return m;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
