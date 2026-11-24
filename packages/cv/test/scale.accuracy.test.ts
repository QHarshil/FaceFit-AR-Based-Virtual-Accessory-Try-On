import { describe, expect, it } from 'vitest';
import { estimateIntrinsics, type CameraIntrinsics } from '../src/camera.ts';
import { mat3Multiply, mat3MulVec3, vec3Add, vec3Norm, vec3Scale, vec3Sub, type Mat3, type Vec3 } from '../src/linalg.ts';
import type { HeadPose } from '../src/pnp.ts';
import { rotationMatrixFromVector } from '../src/rotation.ts';
import { IRIS_PLANE_OFFSET_MM } from '../src/scale/faceScale.ts';
import { canonicalPosition, EYE_LANDMARKS, FACE_WIDTH_LANDMARKS, type Eye } from '../src/scale/landmarks.ts';
import { seededRandom } from './random.ts';
import { measureSyntheticFrames, type SyntheticRun } from './scaleExperiments.ts';
import { AVERAGE_SUBJECT, type SyntheticFrameOptions, type SyntheticSubject } from './syntheticFace.ts';

const DEG = Math.PI / 180;
const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 })!;
const FRAMES = 300;
/** Large-sample SE of the median over the SD of a normal sample, times sqrt(n). */
const MEDIAN_SE_FACTOR = Math.sqrt(Math.PI / 2);

function poseAt(yawDeg: number, pitchDeg: number, rollDeg: number, translationMm: Vec3): HeadPose {
  const yaw = rotationMatrixFromVector([0, yawDeg * DEG, 0]);
  const pitch = rotationMatrixFromVector([pitchDeg * DEG, 0, 0]);
  const roll = rotationMatrixFromVector([0, 0, rollDeg * DEG]);
  return { rotation: mat3Multiply(roll, mat3Multiply(yaw, pitch)) as Mat3, translationMm };
}

/** Renders frames of one subject at one pose with fresh noise and measures each with the given intrinsics. */
function run(
  subject: SyntheticSubject,
  pose: HeadPose,
  sigmaPx: number,
  seed: number,
  options: SyntheticFrameOptions = {},
  measuredWith: CameraIntrinsics = intrinsics,
  count = FRAMES,
): SyntheticRun {
  return measureSyntheticFrames(subject, pose, sigmaPx, count, seededRandom(seed), intrinsics, measuredWith, options);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : 0.5 * (sorted[mid - 1]! + sorted[mid]!);
}

function sd(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

/*
 * Expected per-frame noise, from first principles. The horizontal iris
 * diameter is the gap between two landmarks, so each eye's has SD
 * sqrt(2) sigma px and the mean over two eyes has SD sigma. Each iris centre
 * is the mean of four estimates (the centre, both vertical points' along-axis
 * coordinate, and the horizontal midpoint), variance 3.5 sigma^2 / 16, so
 * the gap between the two centres has SD 0.66 sigma. PD = 11.7 x (PD px over
 * iris px), so its relative SD is sigma sqrt(1 / D^2 + 0.44 / P^2) with D and
 * P the iris diameter and PD in pixels at the eye depth. A frame whose scale
 * comes from one eye has twice the iris variance, so a share f of such
 * frames makes the iris term (1 + f) / D^2. Face width adds two
 * silhouette landmarks: sigma sqrt(1 / D^2 + 2 / W^2). Pose noise moves both
 * eyes' planes together and cancels from the ratio to first order.
 *
 * Bounds: a frame SD from 300 frames has relative standard error 4%, so the
 * measured SD is within [0.8, 1.25] of the prediction. The median is within
 * 4 standard errors (1.2533 SD / sqrt(300)) plus 0.3% of the truth; the
 * 0.3% covers second-order terms: an iris facing its own rotation centre's
 * line of sight instead of the eye point's, and the depth offset of a
 * converged pupil, each under 0.1% at these distances.
 */
const SECOND_ORDER = 0.003;

function predictedRelativeSd(
  sigmaPx: number,
  lengthMm: number,
  extraPoints: number,
  eyeDepthMm: number,
  irisMm = 11.7,
  singleEyeShare = 0,
): number {
  const irisPx = (intrinsics.fx * irisMm) / eyeDepthMm;
  const lengthPx = (intrinsics.fx * lengthMm) / eyeDepthMm;
  return sigmaPx * Math.sqrt((1 + singleEyeShare) / irisPx ** 2 + extraPoints / lengthPx ** 2);
}

function expectRecovered(values: readonly number[], truth: number, predictedSd: number, label: string): void {
  const ratio = sd(values) / predictedSd;
  expect(ratio, `${label} frame SD over predicted`).toBeGreaterThan(0.8);
  expect(ratio, `${label} frame SD over predicted`).toBeLessThan(1.25);
  const bound = (4 * MEDIAN_SE_FACTOR * predictedSd) / Math.sqrt(values.length) + SECOND_ORDER * truth;
  expect(Math.abs(median(values) - truth), `${label} median error`).toBeLessThan(bound);
}

/** The model point the estimator puts each iris plane through, scaled to the subject. */
function eyePointModel(eye: Eye, faceScale: number): Vec3 {
  const [a, b] = EYE_LANDMARKS[eye].corners.map(canonicalPosition) as [Vec3, Vec3];
  return vec3Scale([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 - IRIS_PLANE_OFFSET_MM], faceScale);
}

/** (Zw - Ze) / Zw at the true pose: the face-width landmarks' depth against the irises'. */
function widthElasticity(pose: HeadPose): number {
  const depth = (model: Vec3): number => vec3Add(mat3MulVec3(pose.rotation, vec3Scale(model, SUBJECT.faceScale)), pose.translationMm)[2];
  const widthDepth = (depth(canonicalPosition(FACE_WIDTH_LANDMARKS[0])) + depth(canonicalPosition(FACE_WIDTH_LANDMARKS[1]))) / 2;
  const eyeDepth = (depth(eyePointModel('right', 1)) + depth(eyePointModel('left', 1))) / 2;
  return (widthDepth - eyeDepth) / widthDepth;
}

const SUBJECT: SyntheticSubject = { ...AVERAGE_SUBJECT, faceScale: 1.06, distancePdMm: 64.5 };

describe('metric scale against synthetic ground truth', () => {
  for (const sigmaPx of [0.5, 1]) {
    for (const depthMm of [450, 650, 900]) {
      for (const yawDeg of [0, 8]) {
        it(`recovers PD, face width and depth at ${depthMm} mm, yaw ${yawDeg}, ${sigmaPx} px`, () => {
          const pose = poseAt(yawDeg, 5, 10, [30, -20, depthMm]);
          const { frames, failures, truth } = run(SUBJECT, pose, sigmaPx, depthMm + yawDeg * 7 + sigmaPx * 1000);
          // Both irises fail the 2 px consistency floor together in under 1% of frames at 1 px of noise.
          expect(failures / FRAMES).toBeLessThan(0.01);
          const singleEye = frames.filter((f) => f.irisDiameterRatio === null).length / frames.length;
          const pdSd = predictedRelativeSd(sigmaPx, truth.nearPdMm, 0.4375, truth.eyeDepthMm, 11.7, singleEye) * truth.nearPdMm;
          const widthSd = predictedRelativeSd(sigmaPx, truth.faceWidthMm, 2, truth.eyeDepthMm, 11.7, singleEye) * truth.faceWidthMm;
          const depthSd = predictedRelativeSd(sigmaPx, 1, 0, truth.eyeDepthMm, 11.7, singleEye) * truth.eyeDepthMm;
          expectRecovered(frames.map((f) => f.nearPdMm), truth.nearPdMm, pdSd, 'near PD');
          expectRecovered(frames.map((f) => f.faceWidthMm), truth.faceWidthMm, widthSd, 'face width');
          expectRecovered(frames.map((f) => f.irisDepthMm), truth.eyeDepthMm, depthSd, 'iris depth');
          const distanceSd = (pdSd * truth.distancePdMm) / truth.nearPdMm;
          const bound = (4 * MEDIAN_SE_FACTOR * distanceSd) / Math.sqrt(FRAMES) + SECOND_ORDER * truth.distancePdMm;
          expect(Math.abs(median(frames.map((f) => f.distancePdMm)) - truth.distancePdMm)).toBeLessThan(bound);
          // Face scale also carries the PnP depth noise, so it gets a flat 2%.
          expect(Math.abs(median(frames.map((f) => f.faceScale)) / SUBJECT.faceScale - 1)).toBeLessThan(0.02);
        });
      }
    }
  }

  it('scales PD by the assumed over the true iris diameter, the population bias', () => {
    const subject = { ...SUBJECT, irisDiameterMm: 12.3 };
    const pose = poseAt(3, 5, 0, [0, 0, 550]);
    const { frames, truth } = run(subject, pose, 0.5, 71);
    const expected = (truth.nearPdMm * 11.7) / 12.3;
    const pdSd = predictedRelativeSd(0.5, truth.nearPdMm, 0.4375, truth.eyeDepthMm, 12.3) * expected;
    expectRecovered(frames.map((f) => f.nearPdMm), expected, pdSd, 'biased near PD');
  });

  /*
   * PD is a ratio to the iris in the same plane, so a wrong focal length
   * cancels to first order. Face width does not: its landmarks sit about
   * 6 cm behind the irises, and converting their image width needs the depth
   * ratio, which moves with the distance. The frame reports that elasticity,
   * d ln(width) / d ln(f); the change should follow it within 0.5%. The
   * depth scales with the focal length. A 62 degree camera measured as 50 or
   * 75 degrees changes the focal length by +29% and -22%.
   */
  for (const assumedFovDeg of [50, 75]) {
    it(`keeps PD within 0.3% and moves face width by its elasticity when the focal length is wrong (${assumedFovDeg} deg assumed)`, () => {
      const wrong = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: assumedFovDeg })!;
      const pose = poseAt(5, 8, -6, [20, 10, 600]);
      const right = run(SUBJECT, pose, 0, 81, {}, intrinsics, 1).frames[0]!;
      const off = run(SUBJECT, pose, 0, 81, {}, wrong, 1).frames[0]!;
      const focalChange = Math.log(wrong.fx / intrinsics.fx);
      expect(Math.abs(off.nearPdMm / right.nearPdMm - 1)).toBeLessThan(0.003);
      const elasticity = -widthElasticity(pose);
      expect(Math.abs(Math.log(off.faceWidthMm / right.faceWidthMm) - elasticity * focalChange)).toBeLessThan(0.005);
      expect(Math.abs(Math.log(off.irisDepthMm / right.irisDepthMm) - focalChange)).toBeLessThan(0.01);
    });
  }

  /*
   * An iris plane 3 mm nearer than assumed makes the back-projected iris and
   * pupils larger by the same factor, so PD keeps its value, while face
   * width, scaled by the iris but measured at its own depth, falls by about
   * 3 mm over the eye depth.
   */
  it('keeps PD and moves face width by shift over depth when the iris plane is misplaced', () => {
    const pose = poseAt(4, 6, 0, [0, 0, 500]);
    const base = run(SUBJECT, pose, 0, 91, {}, intrinsics, 1);
    const shifted = run({ ...SUBJECT, irisPlaneShiftMm: 3 }, pose, 0, 91, {}, intrinsics, 1);
    const pdChange = shifted.frames[0]!.nearPdMm / shifted.truth.nearPdMm - base.frames[0]!.nearPdMm / base.truth.nearPdMm;
    expect(Math.abs(pdChange)).toBeLessThan(0.001);
    const widthChange = shifted.frames[0]!.faceWidthMm / base.frames[0]!.faceWidthMm - 1;
    expect(widthChange).toBeCloseTo(-3 / base.truth.eyeDepthMm, 3);
  });

  /*
   * If the eyes look along the head's forward axis instead of at the camera,
   * each iris turns away from its line of sight by an angle theta, reads
   * cos(theta) narrow, and PD reads 1 / mean(cos theta) too large. Within the
   * aggregator's 10 degree yaw limit that is about 1.5% at the centre of the
   * image; each eye's own line of sight adds or removes a few degrees.
   */
  it('overstates PD by 1 / cos(theta) when the gaze follows the head', () => {
    const pose = poseAt(9, 0, 0, [0, 0, 550]);
    const { frames, truth } = run(SUBJECT, pose, 0, 101, { gaze: 'head' }, intrinsics, 1);
    const cosines = (['right', 'left'] as const).map((eye) => {
      const eyePoint = vec3Add(mat3MulVec3(pose.rotation, eyePointModel(eye, SUBJECT.faceScale)), pose.translationMm);
      const towardCamera = vec3Scale(eyePoint, -1 / vec3Norm(eyePoint));
      // Horizontal angle only: the vertical one does not touch the horizontal diameter.
      const forward = mat3MulVec3(pose.rotation, [0, 0, -1]);
      const flat = (v: Vec3): Vec3 => vec3Scale([v[0], 0, v[2]], 1 / Math.hypot(v[0], v[2]));
      const a = flat(towardCamera);
      const b = flat(forward);
      return a[0] * b[0] + a[2] * b[2];
    });
    const expected = 2 / (cosines[0]! + cosines[1]!) - 1;
    const error = frames[0]!.nearPdMm / truth.nearPdMm - 1;
    expect(expected).toBeGreaterThan(0.01);
    expect(Math.abs(error - expected)).toBeLessThan(0.002);
  });

  it('reports the line-of-sight angles of a head turned about the point between the eyes', () => {
    const between = vec3Scale(vec3Add(eyePointModel('right', SUBJECT.faceScale), eyePointModel('left', SUBJECT.faceScale)), 0.5);
    const turnedAbout = (rotation: Mat3): HeadPose => ({ rotation, translationMm: vec3Sub([0, 0, 600], mat3MulVec3(rotation, between)) });
    const yawed = run(SUBJECT, turnedAbout(rotationMatrixFromVector([0, 12 * DEG, 0])), 0, 111, {}, intrinsics, 1).frames[0]!;
    expect(yawed.lineOfSightYawDeg).toBeCloseTo(12, 6);
    expect(yawed.lineOfSightPitchDeg).toBeCloseTo(0, 6);
    const pitched = run(SUBJECT, turnedAbout(rotationMatrixFromVector([-7 * DEG, 0, 0])), 0, 111, {}, intrinsics, 1).frames[0]!;
    expect(pitched.lineOfSightYawDeg).toBeCloseTo(0, 6);
    expect(pitched.lineOfSightPitchDeg).toBeCloseTo(7, 6);
  });
});
