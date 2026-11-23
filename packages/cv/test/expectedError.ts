import type { CameraIntrinsics } from '../src/camera.ts';
import { mat3Multiply, mat3MulVec3, mat3Transpose, solveCholesky } from '../src/linalg.ts';
import type { HeadPose, WeightedModelPoint } from '../src/pnp.ts';
import { rotationVectorFromMatrix } from '../src/rotation.ts';

/**
 * First-order covariance of the weighted least-squares pose for isotropic
 * pixel noise of sigmaPx, linearized at the true pose. With J the 2n x 6
 * Jacobian of the projections in (dw, dt) and W the weights,
 * cov = sigma^2 (J^T W J)^-1 (J^T W^2 J) (J^T W J)^-1. The weights are not
 * inverse variances, so the sandwich form is needed. Row-major 6 x 6 over
 * (dw, dt), where the solved pose is exp([dw]x) R and t + dt.
 */
export function predictedPoseCovariance(
  truth: HeadPose,
  modelPoints: readonly WeightedModelPoint[],
  intrinsics: CameraIntrinsics,
  sigmaPx: number,
  indices: readonly number[] = modelPoints.map((_, index) => index),
): Float64Array {
  const information = new Float64Array(36);
  const weightedSquare = new Float64Array(36);
  const { fx, fy } = intrinsics;
  for (const index of indices) {
    const point = modelPoints[index]!;
    const q = mat3MulVec3(truth.rotation, point.positionMm);
    const x = q[0] + truth.translationMm[0];
    const y = q[1] + truth.translationMm[1];
    const z = q[2] + truth.translationMm[2];
    const ux = fx / z;
    const uz = (-fx * x) / (z * z);
    const vy = fy / z;
    const vz = (-fy * y) / (z * z);
    const jx = [uz * q[1], ux * q[2] - uz * q[0], -ux * q[1], ux, 0, uz];
    const jy = [-vy * q[2] + vz * q[1], -vz * q[0], vy * q[0], 0, vy, vz];
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        const product = jx[a]! * jx[b]! + jy[a]! * jy[b]!;
        information[a * 6 + b] += point.weight * product;
        weightedSquare[a * 6 + b] += point.weight ** 2 * product;
      }
    }
  }
  const inverse = new Float64Array(36);
  for (let column = 0; column < 6; column++) {
    const unit = new Float64Array(6);
    unit[column] = 1;
    const inverseColumn = solveCholesky(information, unit, 6);
    if (!inverseColumn) throw new Error('pose is not observable from these points');
    for (let row = 0; row < 6; row++) inverse[row * 6 + column] = inverseColumn[row]!;
  }
  const covariance = new Float64Array(36);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      let sum = 0;
      for (let k = 0; k < 6; k++) {
        for (let l = 0; l < 6; l++) sum += inverse[r * 6 + k]! * weightedSquare[k * 6 + l]! * inverse[l * 6 + c]!;
      }
      covariance[r * 6 + c] = sigmaPx ** 2 * sum;
    }
  }
  return covariance;
}

/**
 * Rotation and translation errors whitened by their predicted covariance:
 * sqrt(e^T C^-1 e) for each 3-vector. For an estimator that attains the
 * first-order covariance, each follows a chi distribution with 3 degrees of
 * freedom, whatever the pose and distance.
 */
export function whitenedPoseError(
  truth: HeadPose,
  solved: HeadPose,
  covariance: Float64Array,
): { rotation: number; translation: number } {
  const rotationError = rotationVectorFromMatrix(mat3Multiply(solved.rotation, mat3Transpose(truth.rotation)));
  const translationError = [0, 1, 2].map((d) => solved.translationMm[d]! - truth.translationMm[d]!);
  const mahalanobis = (offset: number, error: readonly number[]): number => {
    const block = new Float64Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) block[r * 3 + c] = covariance[(offset + r) * 6 + offset + c]!;
    }
    const precisionTimesError = solveCholesky(block, error, 3);
    if (!precisionTimesError) throw new Error('singular covariance block');
    return Math.sqrt(error.reduce((sum, value, k) => sum + value * precisionTimesError[k]!, 0));
  };
  return { rotation: mahalanobis(0, rotationError), translation: mahalanobis(3, translationError) };
}
