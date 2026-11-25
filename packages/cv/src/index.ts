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
  type HeadPoseUncertainty,
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
export {
  DEFAULT_FACE_MEASUREMENT_LIMITS,
  aggregateFaceMeasurements,
  type FaceMeasurementFailure,
  type FaceMeasurementLimits,
  type FaceMeasurementResult,
  type FaceMeasurementSummary,
  type FrameRejection,
  type MeasurementInterval,
} from './scale/aggregate.ts';
export {
  IRIS_PLANE_OFFSET_MM,
  IRIS_PLANE_OFFSET_SD_MM,
  POPULATION_IRIS_DIAMETER_MM,
  estimateFaceScale,
  type FaceScaleEstimate,
  type FaceScaleFailureReason,
  type FaceScaleOptions,
  type FaceScaleResult,
} from './scale/faceScale.ts';
export {
  measureFaceFrame,
  type FaceFrame,
  type FaceFrameFailureReason,
  type FaceFrameOptions,
  type FaceFrameResult,
} from './scale/frame.ts';
export {
  fitIris,
  irisDiameterPx,
  type IrisDiameterFailureReason,
  type IrisDiameterResult,
  type IrisFit,
  type IrisFitFailureReason,
  type IrisFitOptions,
  type IrisFitResult,
  type IrisPoints,
} from './scale/iris.ts';
export {
  EYE_LANDMARKS,
  FACE_WIDTH_LANDMARKS,
  type Eye,
  type EyeLandmarkIndices,
} from './scale/landmarks.ts';
export {
  FOCAL_LENGTH_RELATIVE_SD,
  PUPIL_TO_ROTATION_CENTRE_MM,
  PUPIL_TO_ROTATION_CENTRE_SD_MM,
  measureFaceWidth,
  measurePupillaryDistance,
  nearToDistancePd,
  type DistancePdConversion,
  type DistancePdOptions,
  type FaceWidthMeasurement,
  type MeasurementFailureReason,
  type PupillaryDistanceMeasurement,
} from './scale/measurements.ts';
