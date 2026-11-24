import type { CameraIntrinsics } from '../src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import type { Vec2 } from '../src/linalg.ts';
import { solveHeadPose, type HeadPose } from '../src/pnp.ts';
import { aggregateFaceMeasurements, type FaceMeasurementLimits, type FaceMeasurementResult } from '../src/scale/aggregate.ts';
import { measureFaceFrame, type FaceFrameResult } from '../src/scale/frame.ts';
import { EYE_LANDMARKS, type Eye } from '../src/scale/landmarks.ts';
import { seededRandom } from './random.ts';
import { renderSyntheticFace, type SyntheticFrame, type SyntheticSubject } from './syntheticFace.ts';

/** Scales one eye's four iris contour points about its centre landmark, as glare or a misfit contour would. */
export function scaleIrisContour(landmarks: Vec2[], eye: Eye, factor: number): void {
  const indices = EYE_LANDMARKS[eye];
  const [cx, cy] = landmarks[indices.irisCentre]!;
  for (const index of [...indices.irisHorizontal, ...indices.irisVertical]) {
    const [x, y] = landmarks[index]!;
    landmarks[index] = [cx + (x - cx) * factor, cy + (y - cy) * factor];
  }
}

/** Moves all five iris points of one eye by the same offset in pixels. */
export function shiftIris(landmarks: Vec2[], eye: Eye, offset: Vec2): void {
  const indices = EYE_LANDMARKS[eye];
  for (const index of [indices.irisCentre, ...indices.irisHorizontal, ...indices.irisVertical]) {
    const [x, y] = landmarks[index]!;
    landmarks[index] = [x + offset[0], y + offset[1]];
  }
}

/** Pushes the second horizontal contour point outward along the pair's direction by a fraction of half the pair's gap. */
export function pushHorizontalPoint(landmarks: Vec2[], eye: Eye, fractionOfRadius: number): void {
  const [first, second] = EYE_LANDMARKS[eye].irisHorizontal;
  const a = landmarks[first]!;
  const b = landmarks[second]!;
  // The gap is two radii, so a step of half the fraction of it is the fraction of a radius.
  const step = fractionOfRadius / 2;
  landmarks[second] = [b[0] + (b[0] - a[0]) * step, b[1] + (b[1] - a[1]) * step];
}

export interface TamperedClip {
  readonly summary: FaceMeasurementResult;
  readonly frames: FaceFrameResult[];
  readonly truth: SyntheticFrame['truth'];
}

/** Renders count frames, applies tamper to each frame's landmarks, then solves, measures and aggregates as the app would. */
export function measureTamperedClip(options: {
  readonly subject: SyntheticSubject;
  readonly pose: HeadPose;
  readonly intrinsics: CameraIntrinsics;
  readonly sigmaPx: number;
  readonly count: number;
  readonly seed: number;
  readonly tamper?: ((landmarks: Vec2[]) => void) | undefined;
  readonly limits?: Partial<FaceMeasurementLimits> | undefined;
}): TamperedClip {
  const random = seededRandom(options.seed);
  const frames: FaceFrameResult[] = [];
  let truth: SyntheticFrame['truth'] | null = null;
  for (let k = 0; k < options.count; k++) {
    const rendered = renderSyntheticFace(options.subject, options.pose, options.intrinsics, options.sigmaPx, random);
    truth = rendered.truth;
    const landmarks = rendered.landmarksPx.map((p) => [...p] as Vec2);
    options.tamper?.(landmarks);
    const pose = solveHeadPose(
      RIGID_FACE_LANDMARKS.map(({ landmarkIndex }) => landmarks[landmarkIndex]!),
      RIGID_FACE_LANDMARKS,
      options.intrinsics,
    );
    frames.push(measureFaceFrame(landmarks, pose, options.intrinsics));
  }
  return { summary: aggregateFaceMeasurements(frames, options.limits), frames, truth: truth! };
}
