// The overlay gate of gateHeadPose (frontend/src/geometry/headPose.ts) on
// single frames, and the share of frames it would hide. gateShare.test.mjs
// checks the constants against the app's source.
import {
  estimateIntrinsics,
  mat3MulVec3,
  projectPoint,
  RIGID_FACE_LANDMARKS,
  rotationMatrixFromVector,
  mat3Multiply,
  solveHeadPose,
} from '../../packages/cv/src/index.ts';

export const GATE = { hideAboveMm: 6, showBelowMm: 5, horizontalFovDeg: 60 };

/**
 * What the gate does with one solve: `failed` or `facing-away` hide at once;
 * `hide` is above the hide threshold; `held` sits between the two thresholds,
 * so a shown overlay stays and a hidden one stays hidden; `shown` is below
 * the show threshold.
 */
export function gateOutcome(solved, intrinsics) {
  if (!solved.ok) return { outcome: 'failed', rmsMm: null };
  const r = solved.rotation;
  const t = solved.translationMm;
  const rmsMm = (solved.rmsReprojectionPx * t[2]) / intrinsics.fx;
  if (!(r[2] * t[0] + r[5] * t[1] + r[8] * t[2] > 0)) return { outcome: 'facing-away', rmsMm };
  if (rmsMm > GATE.hideAboveMm) return { outcome: 'hide', rmsMm };
  return { outcome: rmsMm < GATE.showBelowMm ? 'shown' : 'held', rmsMm };
}

/** Counts per outcome and the shares a shown overlay would hide, and a hidden one would not show. */
export function summarizeOutcomes(outcomes, noFace = 0) {
  const count = (names) => outcomes.filter((o) => names.includes(o.outcome)).length;
  const hidden = count(['failed', 'facing-away', 'hide']);
  const notShown = hidden + count(['held']);
  const rms = outcomes.map((o) => o.rmsMm).filter((v) => v != null).sort((a, b) => a - b);
  const at = (p) => (rms.length ? rms[Math.min(rms.length - 1, Math.floor(p * rms.length))] : null);
  return {
    images: outcomes.length + noFace,
    noFace,
    solved: outcomes.length,
    failed: count(['failed']),
    facingAway: count(['facing-away']),
    aboveHide: count(['hide']),
    between: count(['held']),
    hiddenShare: outcomes.length ? hidden / outcomes.length : null,
    hiddenShareWithNoFace: outcomes.length + noFace ? (hidden + noFace) / (outcomes.length + noFace) : null,
    notShownShare: outcomes.length ? notShown / outcomes.length : null,
    rmsMm: { p50: at(0.5), p95: at(0.95), max: rms.at(-1) ?? null },
  };
}

/** Normalized landmarks to the solver and the gate, with the app's assumed FOV. */
export function gateDetection(detection) {
  const intrinsics = estimateIntrinsics({ width: detection.width, height: detection.height, horizontalFovDeg: GATE.horizontalFovDeg });
  const imagePoints = RIGID_FACE_LANDMARKS.map(({ landmarkIndex }) => {
    const [x, y] = detection.landmarks[landmarkIndex];
    return [x * detection.width, y * detection.height];
  });
  return gateOutcome(solveHeadPose(imagePoints, RIGID_FACE_LANDMARKS, intrinsics), intrinsics);
}

/**
 * A synthetic face at `depthMm`: the canonical rigid landmarks moved by
 * isotropic Gaussian `shapeSigmaMm` (a stand-in for a face that differs from
 * the canonical one), posed within +-30 deg yaw, +-20 pitch and +-15 roll,
 * projected through 1280x720 intrinsics at the app's FOV, plus `pixelSigma`
 * of Gaussian landmark noise.
 */
export function syntheticOutcome(random, depthMm, shapeSigmaMm, pixelSigma) {
  const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: GATE.horizontalFovDeg });
  const deg = Math.PI / 180;
  const rotation = mat3Multiply(
    rotationMatrixFromVector([0, 0, random.uniform(-15, 15) * deg]),
    mat3Multiply(rotationMatrixFromVector([0, random.uniform(-30, 30) * deg, 0]), rotationMatrixFromVector([random.uniform(-20, 20) * deg, 0, 0])),
  );
  const translation = [random.uniform(-0.2, 0.2) * depthMm, random.uniform(-0.1, 0.1) * depthMm, depthMm];
  const imagePoints = RIGID_FACE_LANDMARKS.map(({ positionMm }) => {
    const p = positionMm.map((v) => v + random.gaussian(shapeSigmaMm));
    const c = mat3MulVec3(rotation, p);
    const pixel = projectPoint(intrinsics, [c[0] + translation[0], c[1] + translation[1], c[2] + translation[2]]);
    return [pixel[0] + random.gaussian(pixelSigma), pixel[1] + random.gaussian(pixelSigma)];
  });
  return gateOutcome(solveHeadPose(imagePoints, RIGID_FACE_LANDMARKS, intrinsics), intrinsics);
}
