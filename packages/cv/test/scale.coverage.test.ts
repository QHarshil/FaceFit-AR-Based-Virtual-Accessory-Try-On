import { describe, expect, it } from 'vitest';
import { estimateIntrinsics } from '../src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import { mat3Multiply, type Mat3 } from '../src/linalg.ts';
import { solveHeadPose, type HeadPose } from '../src/pnp.ts';
import { rotationMatrixFromVector } from '../src/rotation.ts';
import { aggregateFaceMeasurements, type FaceMeasurementLimits, type MeasurementInterval } from '../src/scale/aggregate.ts';
import { measureFaceFrame, type FaceFrameOptions, type FaceFrameResult } from '../src/scale/frame.ts';
import { seededRandom, type SeededRandom } from './random.ts';
import { AVERAGE_SUBJECT, renderSyntheticFace, type SyntheticSubject } from './syntheticFace.ts';

const DEG = Math.PI / 180;
/** The app's assumed camera: 60 degrees horizontal. */
const ASSUMED = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 })!;

interface Subject {
  readonly subject: SyntheticSubject;
  readonly pose: HeadPose;
  /** Focal length of the camera that rendered the subject, over the assumed one. */
  readonly focalRatio: number;
  readonly sigmaPx: number;
}

interface Coverage {
  readonly near: number;
  readonly distance: number;
  readonly width: number;
  readonly subjects: number;
}

function covers(interval: MeasurementInterval, truth: number): boolean {
  return interval.lowerMm <= truth && truth <= interval.upperMm;
}

function coverage(
  subjects: number,
  frames: number,
  draw: (random: SeededRandom) => Subject,
  seed: number,
  frameOptions: FaceFrameOptions = {},
  limits: Partial<FaceMeasurementLimits> = {},
): Coverage {
  const random = seededRandom(seed);
  let near = 0;
  let distance = 0;
  let width = 0;
  for (let k = 0; k < subjects; k++) {
    const { subject, pose, focalRatio, sigmaPx } = draw(random);
    const camera = { ...ASSUMED, fx: ASSUMED.fx * focalRatio, fy: ASSUMED.fy * focalRatio };
    let truth: ReturnType<typeof renderSyntheticFace>['truth'] | null = null;
    const results: FaceFrameResult[] = [];
    for (let f = 0; f < frames; f++) {
      const rendered = renderSyntheticFace(subject, pose, camera, sigmaPx, random);
      truth = rendered.truth;
      const solved = solveHeadPose(
        RIGID_FACE_LANDMARKS.map(({ landmarkIndex }) => rendered.landmarksPx[landmarkIndex]!),
        RIGID_FACE_LANDMARKS,
        ASSUMED,
      );
      results.push(measureFaceFrame(rendered.landmarksPx, solved, ASSUMED, frameOptions));
    }
    const summary = aggregateFaceMeasurements(results, limits);
    if (!summary.ok) throw new Error(`subject ${k}: ${summary.reason} ${JSON.stringify(summary.rejectedFrames)}`);
    if (covers(summary.nearPupillaryDistance, truth!.nearPdMm)) near++;
    if (covers(summary.distancePupillaryDistance, truth!.distancePdMm)) distance++;
    if (covers(summary.faceWidth, truth!.faceWidthMm)) width++;
  }
  return { near: near / subjects, distance: distance / subjects, width: width / subjects, subjects };
}

/**
 * A wearer facing the camera. Head yaw within 4 degrees and a sideways
 * offset of at most 25 mm keep the line of sight inside the 10 degree gate
 * at 400 mm even when the focal length is 1.45 times the assumed one (3 SD),
 * which inflates the offset's angle by that factor; pitch within 8 degrees
 * and 30 mm keep it inside the 20 degree gate.
 */
function poseFrom(random: SeededRandom, minDepthMm: number, maxDepthMm: number): HeadPose {
  const yaw = rotationMatrixFromVector([0, random.uniform(-4, 4) * DEG, 0]);
  const pitch = rotationMatrixFromVector([random.uniform(-8, 8) * DEG, 0, 0]);
  const roll = rotationMatrixFromVector([0, 0, random.uniform(-8, 8) * DEG]);
  return {
    rotation: mat3Multiply(roll, mat3Multiply(yaw, pitch)) as Mat3,
    translationMm: [random.uniform(-25, 25), random.uniform(-30, 30), random.uniform(minDepthMm, maxDepthMm)],
  };
}

describe('interval coverage over synthetic subjects', () => {
  /*
   * Every subject draws its iris diameter from N(11.7, 0.5), the population
   * the interval assumes, plus the other unknowns the interval models: the
   * camera's focal length off the assumed one by a factor exp(N(0, 0.15)),
   * and the iris plane 3 mm (SD) off the assumed offset. 20 frames each.
   * A nominal 95% interval covers the truth in 95% of subjects; over 1,000
   * subjects that rate has SD 0.7%, so it should fall in [0.93, 0.97]. Face
   * width's focal term is linearized and the population term dominates
   * every interval, so all three share the bound.
   */
  it('covers PD and face width at about 95% when the iris size follows the population', () => {
    const result = coverage(
      1000,
      20,
      (random) => ({
        subject: {
          ...AVERAGE_SUBJECT,
          irisDiameterMm: 11.7 + random.gaussian(0.5),
          distancePdMm: 63 + random.gaussian(3.5),
          faceScale: random.uniform(0.9, 1.1),
          irisPlaneShiftMm: random.gaussian(3),
        },
        pose: poseFrom(random, 400, 750),
        focalRatio: Math.exp(random.gaussian(0.15)),
        sigmaPx: random.uniform(0.3, 1),
      }),
      7001,
    );
    for (const rate of [result.near, result.distance, result.width]) {
      expect(rate).toBeGreaterThan(0.93);
      expect(rate).toBeLessThan(0.97);
    }
  });

  /*
   * With every iris exactly 11.7 mm and the population term switched off,
   * only the noise term is left: the standard error of the median from 30
   * frames at 1 px and 700 to 850 mm. A z of 1.96 with an SD estimated from
   * 30 frames covers about 94% (Student t with 29 degrees of freedom), and
   * a positive sample autocorrelation of independent frames widens a few
   * intervals. Over 600 subjects the SD of the rate is 0.9%: [0.91, 0.985].
   */
  it('covers PD at about 95% from the noise term alone', () => {
    const result = coverage(
      600,
      30,
      (random) => ({
        subject: { ...AVERAGE_SUBJECT, distancePdMm: 63 + random.gaussian(3.5), faceScale: random.uniform(0.9, 1.1) },
        pose: poseFrom(random, 700, 850),
        focalRatio: 1,
        sigmaPx: 1,
      }),
      7002,
      {},
      { irisDiameterSdMm: 0 },
    );
    expect(result.near).toBeGreaterThan(0.91);
    expect(result.near).toBeLessThan(0.985);
  });
});
