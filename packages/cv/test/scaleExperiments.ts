import { estimateIntrinsics, type CameraIntrinsics } from '../src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import { mat3Multiply, type Mat3 } from '../src/linalg.ts';
import { solveHeadPose, type HeadPose } from '../src/pnp.ts';
import { rotationMatrixFromVector } from '../src/rotation.ts';
import { aggregateFaceMeasurements, type FaceMeasurementLimits, type MeasurementInterval } from '../src/scale/aggregate.ts';
import { estimateFaceScale } from '../src/scale/faceScale.ts';
import { measureFaceFrame, type FaceFrame, type FaceFrameOptions, type FaceFrameResult } from '../src/scale/frame.ts';
import { FIXATION_DISTANCE_RELATIVE_SD, PUPIL_TO_ROTATION_CENTRE_MM, PUPIL_TO_ROTATION_CENTRE_SD_MM } from '../src/scale/measurements.ts';
import { seededRandom, type SeededRandom } from './random.ts';
import { AVERAGE_SUBJECT, renderSyntheticFace, type SyntheticFrame, type SyntheticFrameOptions, type SyntheticSubject } from './syntheticFace.ts';

const DEG = Math.PI / 180;
/** The app's assumed camera: 60 degrees horizontal. */
export const ASSUMED_INTRINSICS = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 })!;

export interface SyntheticRun {
  readonly frames: FaceFrame[];
  /** Frames where both irises failed the consistency check. */
  readonly failures: number;
  readonly truth: SyntheticFrame['truth'];
}

/**
 * Renders frames of one subject at one pose through renderedWith, solves the
 * pose and measures each frame with measuredWith, as the app would.
 */
export function measureSyntheticFrames(
  subject: SyntheticSubject,
  pose: HeadPose,
  sigmaPx: number,
  count: number,
  random: SeededRandom,
  renderedWith: CameraIntrinsics,
  measuredWith: CameraIntrinsics = renderedWith,
  options: SyntheticFrameOptions = {},
  frameOptions: FaceFrameOptions = {},
): SyntheticRun & { readonly results: FaceFrameResult[] } {
  const frames: FaceFrame[] = [];
  const results: FaceFrameResult[] = [];
  let failures = 0;
  let truth: SyntheticFrame['truth'] | null = null;
  for (let k = 0; k < count; k++) {
    const rendered = renderSyntheticFace(subject, pose, renderedWith, sigmaPx, random, options);
    truth = rendered.truth;
    const solved = solveHeadPose(
      RIGID_FACE_LANDMARKS.map(({ landmarkIndex }) => rendered.landmarksPx[landmarkIndex]!),
      RIGID_FACE_LANDMARKS,
      measuredWith,
    );
    const frame = measureFaceFrame(rendered.landmarksPx, solved, measuredWith, frameOptions);
    results.push(frame);
    if (frame.ok) frames.push(frame);
    else if (solved.ok && !estimateFaceScale(rendered.landmarksPx, solved, measuredWith).ok) failures++;
    else throw new Error(`synthetic frame ${k} failed: ${frame.reason}`);
  }
  return { frames, results, failures, truth: truth! };
}

export interface SyntheticWearer {
  readonly subject: SyntheticSubject;
  readonly pose: HeadPose;
  /** Focal length of the camera that rendered the subject, over the assumed one. */
  readonly focalRatio: number;
  readonly sigmaPx: number;
}

/** Share of subjects whose 95% intervals cover the truth. */
export interface Coverage {
  readonly near: number;
  readonly distance: number;
  readonly width: number;
  readonly subjects: number;
  readonly framesPerSubject: number;
}

function covers(interval: MeasurementInterval, truth: number): boolean {
  return interval.lowerMm <= truth && truth <= interval.upperMm;
}

export function coverage(
  subjects: number,
  framesPerSubject: number,
  draw: (random: SeededRandom) => SyntheticWearer,
  seed: number,
  limits: Partial<FaceMeasurementLimits> = {},
  alterFrame: (frame: FaceFrame) => FaceFrame = (frame) => frame,
): Coverage {
  const random = seededRandom(seed);
  let near = 0;
  let distance = 0;
  let width = 0;
  for (let k = 0; k < subjects; k++) {
    const { subject, pose, focalRatio, sigmaPx } = draw(random);
    const camera = { ...ASSUMED_INTRINSICS, fx: ASSUMED_INTRINSICS.fx * focalRatio, fy: ASSUMED_INTRINSICS.fy * focalRatio };
    const run = measureSyntheticFrames(subject, pose, sigmaPx, framesPerSubject, random, camera, ASSUMED_INTRINSICS);
    const summary = aggregateFaceMeasurements(run.results.map((frame) => (frame.ok ? alterFrame(frame) : frame)), limits);
    if (!summary.ok) throw new Error(`subject ${k}: ${summary.reason} ${JSON.stringify(summary.rejectedFrames)}`);
    if (covers(summary.nearPupillaryDistance, run.truth.nearPdMm)) near++;
    if (covers(summary.distancePupillaryDistance, run.truth.distancePdMm)) distance++;
    if (covers(summary.faceWidth, run.truth.faceWidthMm)) width++;
  }
  return { near: near / subjects, distance: distance / subjects, width: width / subjects, subjects, framesPerSubject };
}

/**
 * A wearer facing the camera. Head yaw within 4 degrees and a sideways
 * offset of at most 25 mm keep the line of sight inside the 10 degree gate
 * at 400 mm even when the focal length is 1.45 times the assumed one (3 SD),
 * which inflates the offset's angle by that factor; pitch within 8 degrees
 * and 30 mm keep it inside the 20 degree gate.
 */
export function poseFrom(random: SeededRandom, minDepthMm: number, maxDepthMm: number): HeadPose {
  const yaw = rotationMatrixFromVector([0, random.uniform(-4, 4) * DEG, 0]);
  const pitch = rotationMatrixFromVector([random.uniform(-8, 8) * DEG, 0, 0]);
  const roll = rotationMatrixFromVector([0, 0, random.uniform(-8, 8) * DEG]);
  return {
    rotation: mat3Multiply(roll, mat3Multiply(yaw, pitch)) as Mat3,
    translationMm: [random.uniform(-25, 25), random.uniform(-30, 30), random.uniform(minDepthMm, maxDepthMm)],
  };
}

/**
 * Wearers whose iris diameter follows N(11.7, 0.5), with the other unknowns
 * the intervals model: a focal length off the assumed one by a factor
 * exp(N(0, 0.15)), the iris plane 3 mm (SD) off the assumed offset, and the
 * pupil-to-rotation-centre lever drawn from N(10.5, 1.5).
 */
export function populationCoverage(subjects: number, seed: number, alterFrame?: (frame: FaceFrame) => FaceFrame): Coverage {
  return coverage(
    subjects,
    20,
    (random) => ({
      subject: {
        ...AVERAGE_SUBJECT,
        irisDiameterMm: 11.7 + random.gaussian(0.5),
        distancePdMm: 63 + random.gaussian(3.5),
        faceScale: random.uniform(0.9, 1.1),
        irisPlaneShiftMm: random.gaussian(3),
        pupilToRotationCentreMm: PUPIL_TO_ROTATION_CENTRE_MM + random.gaussian(PUPIL_TO_ROTATION_CENTRE_SD_MM),
      },
      pose: poseFrom(random, 400, 750),
      focalRatio: Math.exp(random.gaussian(0.15)),
      sigmaPx: random.uniform(0.3, 1),
    }),
    seed,
    {},
    alterFrame,
  );
}

/**
 * Distance PD with the iris population term off, so the near-to-distance
 * conversion carries weight: every iris 11.7 mm, the lever drawn from
 * N(10.5, 1.5), wearers at 380 to 520 mm where the correction is largest,
 * and 0.2 to 0.4 px of noise over 30 frames. The interval gives the
 * fixation distance a 20% SD; a focal length off by exp(N(0, 0.2)) moves the
 * iris-implied distance by that factor and leaves near PD alone, so it
 * realizes the whole 20%.
 */
export function conversionCoverage(subjects: number, seed: number, alterFrame?: (frame: FaceFrame) => FaceFrame): Coverage {
  return coverage(
    subjects,
    30,
    (random) => ({
      subject: {
        ...AVERAGE_SUBJECT,
        distancePdMm: 63 + random.gaussian(3.5),
        faceScale: random.uniform(0.9, 1.1),
        pupilToRotationCentreMm: PUPIL_TO_ROTATION_CENTRE_MM + random.gaussian(PUPIL_TO_ROTATION_CENTRE_SD_MM),
      },
      pose: poseFrom(random, 380, 520),
      focalRatio: Math.exp(random.gaussian(FIXATION_DISTANCE_RELATIVE_SD)),
      sigmaPx: random.uniform(0.2, 0.4),
    }),
    seed,
    { irisDiameterSdMm: 0 },
    alterFrame,
  );
}

/**
 * The population draw with every camera's focal length a fixed ratio to the
 * assumed one, for cameras outside the assumed 15% spread. Wearers sit at
 * 500 to 750 mm so a ratio up to 1.8 keeps the line of sight inside the
 * gates.
 */
export function fixedFocalCoverage(subjects: number, seed: number, focalRatio: number): Coverage {
  return coverage(
    subjects,
    20,
    (random) => ({
      subject: {
        ...AVERAGE_SUBJECT,
        irisDiameterMm: 11.7 + random.gaussian(0.5),
        distancePdMm: 63 + random.gaussian(3.5),
        faceScale: random.uniform(0.9, 1.1),
        irisPlaneShiftMm: random.gaussian(3),
        pupilToRotationCentreMm: PUPIL_TO_ROTATION_CENTRE_MM + random.gaussian(PUPIL_TO_ROTATION_CENTRE_SD_MM),
      },
      pose: poseFrom(random, 500, 750),
      focalRatio,
      sigmaPx: random.uniform(0.3, 1),
    }),
    seed,
  );
}

/** Every iris 11.7 mm and the population term off, so only the noise term is left: 30 frames at 1 px, 700 to 850 mm. */
export function noiseOnlyCoverage(subjects: number, seed: number): Coverage {
  return coverage(
    subjects,
    30,
    (random) => ({
      subject: { ...AVERAGE_SUBJECT, distancePdMm: 63 + random.gaussian(3.5), faceScale: random.uniform(0.9, 1.1) },
      pose: poseFrom(random, 700, 850),
      focalRatio: 1,
      sigmaPx: 1,
    }),
    seed,
    { irisDiameterSdMm: 0 },
  );
}
