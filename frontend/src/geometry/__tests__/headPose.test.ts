import {
  angleBetweenRotations,
  estimateIntrinsics,
  IDENTITY3,
  type CameraIntrinsics,
  type HeadPose,
  type HeadPoseResult,
  type SolveHeadPoseOptions,
} from '@facefit/cv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LandmarkFrame } from '../../perception/types';
import {
  rotationFromDegrees,
  seededGaussian,
  syntheticLandmarkFrame,
} from '../../test/syntheticFace';

const solveCalls: (SolveHeadPoseOptions | undefined)[] = [];

vi.mock('@facefit/cv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@facefit/cv')>();
  return {
    ...actual,
    solveHeadPose: (...args: Parameters<typeof actual.solveHeadPose>) => {
      solveCalls.push(args[3]);
      return actual.solveHeadPose(...args);
    },
  };
});

const {
  createHeadPoseTracker,
  DEFAULT_HORIZONTAL_FOV_DEG,
  gateHeadPose,
  landmarksToPixels,
  MAX_RMS_REPROJECTION_MM,
  SHOW_BELOW_RMS_MM,
} = await import('../headPose');

const DEG = 180 / Math.PI;

const intrinsicsOf = (width: number, height: number): CameraIntrinsics => {
  const intrinsics = estimateIntrinsics({
    width,
    height,
    horizontalFovDeg: DEFAULT_HORIZONTAL_FOV_DEG,
  });
  if (!intrinsics) throw new Error('invalid test intrinsics');
  return intrinsics;
};

const translationError = (a: HeadPose, b: HeadPose) =>
  Math.hypot(...a.translationMm.map((value, axis) => value - (b.translationMm[axis] as number)));

const noFace = (width: number, height: number): LandmarkFrame => ({
  timestampMs: 0,
  width,
  height,
  landmarks: new Float32Array(0),
  faceCount: 0,
});

beforeEach(() => {
  solveCalls.length = 0;
});

describe('landmarksToPixels', () => {
  it.each([
    [1280, 720],
    [640, 480],
    [720, 1280],
  ])('scales normalized landmarks by a %ix%i frame', (width, height) => {
    const pose: HeadPose = { rotation: IDENTITY3, translationMm: [0, 0, 600] };
    const frame = syntheticLandmarkFrame(pose, intrinsicsOf(width, height));
    const [pixel] = landmarksToPixels(frame, [4]);
    const offset = 4 * 3;
    expect(pixel?.[0]).toBeCloseTo((frame.landmarks[offset] as number) * width, 9);
    expect(pixel?.[1]).toBeCloseTo((frame.landmarks[offset + 1] as number) * height, 9);
  });
});

describe('createHeadPoseTracker round trip', () => {
  // Exact projections stored as float32 normalized coordinates are off by at
  // most 2^-25 of the frame size, about 4e-5 px at 1280 px. At the solver's
  // sensitivity near 600 mm (about 0.4 deg and 2 mm per pixel, from the
  // expected-error formula in docs/geometry.md) that moves the pose by under
  // 1e-4 deg and 1e-4 mm, so 1e-3 deg and 0.01 mm leave room for the solver's
  // convergence tolerance while catching any scaling or axis mistake.
  it.each([
    { name: 'frontal', size: [1280, 720], angles: [0, 0, 0], at: [0, 0, 600] },
    { name: 'yawed and off-centre', size: [1280, 720], angles: [5, 30, -4], at: [-120, 40, 700] },
    { name: 'pitched and rolled', size: [1280, 720], angles: [-20, -10, 25], at: [60, -50, 450] },
    { name: '4:3 frame', size: [640, 480], angles: [10, -25, 8], at: [30, 20, 550] },
    { name: 'portrait frame', size: [720, 1280], angles: [-8, 15, -12], at: [-20, 90, 500] },
  ])('recovers the $name pose', ({ size, angles, at }) => {
    const intrinsics = intrinsicsOf(size[0] as number, size[1] as number);
    const pose: HeadPose = {
      rotation: rotationFromDegrees(angles[0] as number, angles[1] as number, angles[2] as number),
      translationMm: [at[0] as number, at[1] as number, at[2] as number],
    };
    const estimate = createHeadPoseTracker().update(syntheticLandmarkFrame(pose, intrinsics));
    expect(estimate.trusted).toBe(true);
    if (!estimate.trusted) return;
    expect(estimate.intrinsics).toEqual(intrinsics);
    expect(angleBetweenRotations(estimate.fit.pose.rotation, pose.rotation) * DEG).toBeLessThan(
      1e-3,
    );
    expect(translationError(estimate.fit.pose, pose)).toBeLessThan(0.01);
    expect(estimate.fit.inlierCount).toBe(33);
  });

  // Per pixel of noise at 600 mm and a 60 degree FOV, docs/geometry.md predicts
  // about 0.36 deg for yaw and pitch and 1.6 mm for depth, one parameter at a
  // time. Coupling between yaw and sideways translation raises the joint
  // error, so the bounds sit at about 5 and 6 times those values over 200
  // seeded trials with 1 px noise.
  it('stays within 2 deg and 10 mm under 1 px landmark noise', () => {
    const intrinsics = intrinsicsOf(1280, 720);
    const gaussian = seededGaussian(7);
    let worstDeg = 0;
    let worstMm = 0;
    for (let trial = 0; trial < 200; trial += 1) {
      const pose: HeadPose = {
        rotation: rotationFromDegrees(gaussian(10), gaussian(15), gaussian(10)),
        translationMm: [gaussian(60), gaussian(40), 600],
      };
      const tracker = createHeadPoseTracker({ maxRmsReprojectionMm: Infinity });
      const estimate = tracker.update(
        syntheticLandmarkFrame(pose, intrinsics, { sigmaPx: 1, gaussian }),
      );
      expect(estimate.trusted).toBe(true);
      if (!estimate.trusted) return;
      worstDeg = Math.max(
        worstDeg,
        angleBetweenRotations(estimate.fit.pose.rotation, pose.rotation) * DEG,
      );
      worstMm = Math.max(worstMm, translationError(estimate.fit.pose, pose));
    }
    expect(worstDeg).toBeLessThan(2);
    expect(worstMm).toBeLessThan(10);
  });
});

describe('createHeadPoseTracker warm start', () => {
  it('passes the last trusted pose to the solver and drops it after a frame without a face', () => {
    const intrinsics = intrinsicsOf(1280, 720);
    const first: HeadPose = { rotation: rotationFromDegrees(0, 10, 0), translationMm: [0, 0, 600] };
    const second: HeadPose = {
      rotation: rotationFromDegrees(0, 12, 0),
      translationMm: [5, 0, 600],
    };
    const tracker = createHeadPoseTracker();

    const firstEstimate = tracker.update(syntheticLandmarkFrame(first, intrinsics));
    tracker.update(syntheticLandmarkFrame(second, intrinsics));
    tracker.update(noFace(1280, 720));
    tracker.update(syntheticLandmarkFrame(second, intrinsics));

    expect(solveCalls).toHaveLength(3);
    expect(solveCalls[0]?.initialPose).toBeUndefined();
    expect(firstEstimate.trusted && solveCalls[1]?.initialPose).toEqual(firstEstimate.fit?.pose);
    expect(solveCalls[2]?.initialPose).toBeUndefined();
  });

  it('keeps the last trusted pose as the warm start across a gated frame', () => {
    const intrinsics = intrinsicsOf(1280, 720);
    const pose: HeadPose = { rotation: rotationFromDegrees(0, 10, 0), translationMm: [0, 0, 600] };
    const noisy = syntheticLandmarkFrame(pose, intrinsics, {
      sigmaPx: 20,
      gaussian: seededGaussian(3),
    });
    const tracker = createHeadPoseTracker();

    const trusted = tracker.update(syntheticLandmarkFrame(pose, intrinsics));
    const gated = tracker.update(noisy);
    tracker.update(syntheticLandmarkFrame(pose, intrinsics));

    expect(gated).toMatchObject({ trusted: false, reason: 'reprojection' });
    expect(solveCalls[2]?.initialPose).toEqual(trusted.fit?.pose);
  });
});

describe('gate', () => {
  const intrinsics: CameraIntrinsics = {
    fx: 1000,
    fy: 1000,
    cx: 640,
    cy: 360,
    width: 1280,
    height: 720,
  };
  // At 500 mm and fx 1000, one millimetre at the face is two pixels.
  const solution = (rmsReprojectionPx: number): HeadPoseResult => ({
    ok: true,
    rotation: IDENTITY3,
    translationMm: [0, 0, 500],
    rmsReprojectionPx,
    inlierIndices: [0, 1, 2, 3, 4, 5],
    iterations: 3,
  });

  it('shows a solve exactly at the threshold and hides one just above it', () => {
    const atThreshold = gateHeadPose(solution(2 * MAX_RMS_REPROJECTION_MM), intrinsics);
    expect(atThreshold.trusted).toBe(true);
    expect(atThreshold.fit?.rmsReprojectionMm).toBe(MAX_RMS_REPROJECTION_MM);

    const above = gateHeadPose(solution(2 * MAX_RMS_REPROJECTION_MM + 1e-9), intrinsics);
    expect(above).toMatchObject({ trusted: false, reason: 'reprojection' });
    expect(above.fit?.inlierCount).toBe(6);
  });

  it('hides a failed solve with the solver reason', () => {
    expect(gateHeadPose({ ok: false, reason: 'implausible-depth' }, intrinsics)).toEqual({
      trusted: false,
      reason: 'implausible-depth',
      intrinsics,
      fit: null,
    });
  });

  it('hides a non-finite reprojection error', () => {
    expect(gateHeadPose(solution(Number.NaN), intrinsics).trusted).toBe(false);
  });

  it('applies the tracker threshold at the boundary', () => {
    const frame = syntheticLandmarkFrame(
      { rotation: rotationFromDegrees(0, 5, 0), translationMm: [0, 0, 600] },
      intrinsicsOf(1280, 720),
      { sigmaPx: 2, gaussian: seededGaussian(11) },
    );
    const probe = createHeadPoseTracker({ maxRmsReprojectionMm: Infinity }).update(frame);
    const rmsMm = probe.fit?.rmsReprojectionMm ?? Number.NaN;
    expect(rmsMm).toBeGreaterThan(0);

    expect(createHeadPoseTracker({ maxRmsReprojectionMm: rmsMm }).update(frame).trusted).toBe(true);
    expect(
      createHeadPoseTracker({ maxRmsReprojectionMm: rmsMm * (1 - 1e-9) }).update(frame),
    ).toMatchObject({ trusted: false, reason: 'reprojection' });
  });

  it('hides a frame without a face and a frame with no size', () => {
    const tracker = createHeadPoseTracker();
    expect(tracker.update(noFace(1280, 720))).toMatchObject({ trusted: false, reason: 'no-face' });
    expect(tracker.update(noFace(0, 0))).toMatchObject({
      trusted: false,
      reason: 'invalid-frame-size',
      intrinsics: null,
    });
    expect(solveCalls).toHaveLength(0);
  });
});

describe('facing gate', () => {
  const mirrored = (frame: LandmarkFrame): LandmarkFrame => {
    const landmarks = Float32Array.from(frame.landmarks);
    for (let i = 0; i < landmarks.length; i += 3) landmarks[i] = 1 - (landmarks[i] as number);
    return { ...frame, landmarks };
  };

  it('hides a solve whose face points away from the camera', () => {
    const intrinsics = intrinsicsOf(1280, 720);
    const gaussian = seededGaussian(5);
    let hidden = 0;
    for (let trial = 0; trial < 20; trial += 1) {
      const pose: HeadPose = {
        rotation: rotationFromDegrees(gaussian(5), gaussian(10), gaussian(5)),
        translationMm: [gaussian(40), gaussian(30), 500 + trial * 10],
      };
      const frame = mirrored(syntheticLandmarkFrame(pose, intrinsics));
      const estimate = createHeadPoseTracker().update(frame);
      if (!estimate.trusted) hidden += 1;
    }
    expect(hidden).toBe(20);
  });

  it('reports the facing reason for a solve that fits but looks away', () => {
    const intrinsics = intrinsicsOf(1280, 720);
    const away: HeadPoseResult = {
      ok: true,
      rotation: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
      translationMm: [0, 0, 500],
      rmsReprojectionPx: 1,
      inlierIndices: [0, 1, 2, 3, 4, 5],
      iterations: 3,
    };
    expect(gateHeadPose(away, intrinsics)).toMatchObject({ trusted: false, reason: 'facing-away' });
  });
});

describe('gate hysteresis', () => {
  const intrinsics: CameraIntrinsics = {
    fx: 1000,
    fy: 1000,
    cx: 640,
    cy: 360,
    width: 1280,
    height: 720,
  };
  const at = (mm: number): HeadPoseResult => ({
    ok: true,
    rotation: IDENTITY3,
    translationMm: [0, 0, 500],
    rmsReprojectionPx: 2 * mm,
    inlierIndices: [0, 1, 2, 3, 4, 5],
    iterations: 3,
  });

  it('keeps the reshow value below the hide value and above the measured blink maximum', () => {
    expect(SHOW_BELOW_RMS_MM).toBeLessThan(MAX_RMS_REPROJECTION_MM);
    expect(SHOW_BELOW_RMS_MM).toBeGreaterThan(4.53);
  });

  it('stays hidden between the two values and shows again below the lower one', () => {
    const between = (SHOW_BELOW_RMS_MM + MAX_RMS_REPROJECTION_MM) / 2;
    expect(gateHeadPose(at(between), intrinsics, { wasShown: true }).trusted).toBe(true);
    expect(gateHeadPose(at(between), intrinsics, { wasShown: false }).trusted).toBe(false);
    expect(
      gateHeadPose(at(SHOW_BELOW_RMS_MM - 1e-6), intrinsics, { wasShown: false }).trusted,
    ).toBe(true);
    expect(gateHeadPose(at(SHOW_BELOW_RMS_MM), intrinsics, { wasShown: false }).trusted).toBe(
      false,
    );
  });

  it('hides above the upper value when shown', () => {
    const above = gateHeadPose(at(MAX_RMS_REPROJECTION_MM + 1e-6), intrinsics, { wasShown: true });
    expect(above).toMatchObject({ trusted: false, reason: 'reprojection' });
  });

  it('does not flicker for a value oscillating across the upper value', () => {
    const readings = [-0.1, 0.1, -0.1, 0.1, -0.1, 0.1].map((d) => MAX_RMS_REPROJECTION_MM + d);
    let wasShown = true;
    const shown = readings.map((mm) => {
      const { trusted } = gateHeadPose(at(mm), intrinsics, { wasShown });
      wasShown = trusted;
      return trusted;
    });
    // Without hysteresis this would read true, false, true, false, true, false.
    expect(shown).toEqual([true, false, false, false, false, false]);
  });

  it('carries the state across frames in the tracker', () => {
    const pose: HeadPose = { rotation: rotationFromDegrees(0, 5, 0), translationMm: [0, 0, 600] };
    const size = intrinsicsOf(1280, 720);
    // The same noise pattern at three scales gives three increasing RMS values.
    const withNoise = (sigmaPx: number) =>
      syntheticLandmarkFrame(pose, size, { sigmaPx, gaussian: seededGaussian(11) });
    const [low, mid, high] = [1, 2, 4].map(withNoise) as [
      LandmarkFrame,
      LandmarkFrame,
      LandmarkFrame,
    ];
    const rms = (frame: LandmarkFrame) =>
      createHeadPoseTracker({ maxRmsReprojectionMm: Infinity }).update(frame).fit
        ?.rmsReprojectionMm ?? Number.NaN;
    const tracker = createHeadPoseTracker({
      maxRmsReprojectionMm: (rms(mid) + rms(high)) / 2,
      showBelowRmsMm: (rms(low) + rms(mid)) / 2,
    });
    const shown = [low, high, mid, low, mid].map((frame) => tracker.update(frame).trusted);
    expect(shown).toEqual([true, false, false, true, true]);
  });
});
