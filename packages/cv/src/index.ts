export {
  estimateIntrinsics,
  isValidIntrinsics,
  projectPoint,
  projectionMatrixFromIntrinsics,
  type CameraIntrinsics,
  type IntrinsicsFromFovInput,
} from './camera.ts';
export {
  DEFAULT_MAX_GAP_MS,
  DEFAULT_MAX_PREDICTION_MS,
  DEFAULT_MAX_STALE_MS,
  type PoseFilter,
  type PoseFilterTiming,
} from './filter/poseFilter.ts';
export { oneEuroAlpha, oneEuroPose, type OneEuroChannel, type OneEuroPoseOptions } from './filter/oneEuroPose.ts';
export { RIGID_FACE_LANDMARKS, RIGID_FACE_LANDMARK_INDICES, type FaceModelLandmark } from './faceModel.ts';
export { IDENTITY3, mat3Multiply, mat3MulVec3, mat3Transpose, type Mat3, type Vec2, type Vec3 } from './linalg.ts';
export {
  MIN_POINTS,
  solveHeadPose,
  type HeadPose,
  type HeadPoseFailure,
  type HeadPoseFailureReason,
  type HeadPoseResult,
  type HeadPoseSolution,
  type SolveHeadPoseOptions,
  type WeightedModelPoint,
} from './pnp.ts';
export { poseKalman, type PoseKalmanOptions } from './filter/poseKalman.ts';
export {
  angleBetweenQuaternions,
  angleBetweenRotations,
  isRotationMatrix,
  matrixFromQuaternion,
  quaternionConjugate,
  quaternionFromMatrix,
  quaternionFromRotationVector,
  quaternionMultiply,
  rotationMatrixFromVector,
  rotationVectorFromMatrix,
  rotationVectorFromQuaternion,
  type Quaternion,
} from './rotation.ts';
