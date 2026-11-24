import {
  projectionMatrixFromIntrinsics,
  type CameraIntrinsics,
  type Vec2,
  type Vec3,
} from '@facefit/cv';
import * as THREE from 'three';
import type { RigidTransform } from '../geometry/glassesPlacement';

/** Clip planes in millimetres, around the solver's 100 to 5000 mm depth range plus temple length. */
export const NEAR_MM = 10;
export const FAR_MM = 10000;

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
