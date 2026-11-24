import {
  projectionMatrixFromIntrinsics,
  type CameraIntrinsics,
  type Vec2,
  type Vec3,
} from '@facefit/cv';
import * as THREE from 'three';
import { coverFit, type Size } from '../geometry/coverFit';
import type { RigidTransform } from '../geometry/glassesPlacement';

/** Clip planes in millimetres, around the solver's 100 to 5000 mm depth range plus temple length. */
export const NEAR_MM = 10;
export const FAR_MM = 10000;

/** Most device pixels per video pixel the canvas renders at, to bound fill cost and memory. */
export const MAX_RENDER_PIXEL_RATIO = 2;

/**
 * Renderer pixel ratio at which the canvas has a device pixel for each one it
 * is displayed on. The canvas has the video's size and is scaled by the cover
 * fit to the page, so it covers the display at the cover scale times the
 * device pixel ratio. Never below 1, and capped at MAX_RENDER_PIXEL_RATIO.
 * The projection stays that of the video: normalized device coordinates do not
 * depend on the buffer's resolution.
 */
export function renderPixelRatio(video: Size, display: Size, devicePixelRatio: number): number {
  const fit = coverFit(video, display);
  if (!fit || !(devicePixelRatio > 0)) return 1;
  return Math.min(MAX_RENDER_PIXEL_RATIO, Math.max(1, fit.scale * devicePixelRatio));
}

/**
 * Gives a camera at the origin the projection of the video's intrinsics, so a
 * point in millimetres renders on the pixel the camera would have imaged it
 * at. Returns false for intrinsics the projection cannot use.
 */
export function applyIntrinsics(camera: THREE.Camera, intrinsics: CameraIntrinsics): boolean {
  const projection = projectionMatrixFromIntrinsics(intrinsics, NEAR_MM, FAR_MM);
  if (!projection) return false;
  camera.projectionMatrix.fromArray(projection);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return true;
}

export function applyTransform(object: THREE.Object3D, transform: RigidTransform) {
  // Matrix3.set takes row-major arguments, the layout of Mat3.
  const rotation = new THREE.Matrix4().setFromMatrix3(
    new THREE.Matrix3().set(...transform.rotation),
  );
  object.quaternion.setFromRotationMatrix(rotation);
  object.position.set(...transform.translationMm);
  object.updateMatrixWorld(true);
}

/** A point in eye space to the video pixel it renders on. */
export function eyeToVideoPixel(
  camera: THREE.Camera,
  intrinsics: CameraIntrinsics,
  point: Vec3,
): Vec2 {
  const ndc = new THREE.Vector3(...point).project(camera);
  return [((ndc.x + 1) / 2) * intrinsics.width, ((1 - ndc.y) / 2) * intrinsics.height];
}
