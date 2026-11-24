#!/usr/bin/env node
// Head-pose accuracy on AFLW2000-3D for three methods on the same MediaPipe
// landmarks: the app's eye-line heuristic, MediaPipe's facial transformation
// matrix and solveHeadPose from packages/cv. Merges
// runs["pose-benchmark-aflw2000"] into eval/results.json.
//
//   node eval/benchmark/pose-benchmark.mjs                 refuses a dirty working tree
//   node eval/benchmark/pose-benchmark.mjs --allow-dirty   writes eval/.cache/results-dirty.json instead
//   node eval/benchmark/pose-benchmark.mjs --table         prints the docs table from eval/results.json
//
// Needs eval/datasets/download-aflw2000.mjs and extract-landmarks.mjs first.
// Protocol and conventions: docs/pose-benchmark.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateIntrinsics, RIGID_FACE_LANDMARKS, solveHeadPose } from '../../packages/cv/src/index.ts';
import { AFLW2000_DIR, AFLW2000_SAMPLES, AFLW2000_SHA256, aflw2000Samples } from '../datasets/download-aflw2000.mjs';
import { aflwAngles, cameraRotationFromSolver, rotationFromMediapipeMatrix } from './conventions.mjs';
import { DELEGATE, LANDMARK_CACHE, LANDMARKER_OPTIONS, MODEL_SHA256, TASKS_VISION_VERSION } from './extract-landmarks.mjs';
import { heuristicRotation } from './heuristicPose.mjs';
import { readMatFile } from './matFile.mjs';
import { correlation, PROTOCOL_LIMIT_DEG, poseErrorsDeg, summarizePoseErrors, withinProtocol } from './poseMetrics.mjs';
import { renderConventionCheck, renderPoseTable } from './poseTable.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(EVAL, '..');
const RESULTS = join(EVAL, 'results.json');
export const RESULTS_KEY = 'pose-benchmark-aflw2000';
// MediaPipe's geometry pipeline assumes a 63 degree vertical FOV. The images
// are square, so the same FOV holds horizontally, and the two perspective
// methods share one camera model.
const PRIMARY_FOV_DEG = 63;
const SENSITIVITY_FOV_DEG = [20, 30, 40, 50, 60, 63, 70];
const NEAR_FRONTAL_DEG = 30;
const YAW_BINS_DEG = [[0, 30], [30, 60], [60, PROTOCOL_LIMIT_DEG]];
const DEG = 180 / Math.PI;
const AXES = ['pitch', 'yaw', 'roll'];
const METHODS = ['heuristic', 'mediapipeMatrix', 'solveHeadPose'];

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
const round = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v)));

if (process.argv.includes('--table')) {
  const entry = JSON.parse(readFileSync(RESULTS, 'utf8')).runs[RESULTS_KEY];
  if (!entry) throw new Error(`no runs["${RESULTS_KEY}"] in ${RESULTS}`);
  console.log(`${renderPoseTable(entry)}\n\n${renderConventionCheck(entry)}`);
  process.exit(0);
}

const allowDirty = process.argv.includes('--allow-dirty');
const dirty = git('status', '--porcelain').split('\n').filter((line) => line && !line.endsWith('eval/results.json'));
if (dirty.length && !allowDirty) {
  console.error(`working tree is dirty; commit first or pass --allow-dirty\n${dirty.join('\n')}`);
  process.exit(1);
}

const names = aflw2000Samples();
if (names.length !== AFLW2000_SAMPLES) throw new Error(`found ${names.length} AFLW2000 samples; run eval/datasets/download-aflw2000.mjs`);
if (!existsSync(LANDMARK_CACHE)) throw new Error(`no ${LANDMARK_CACHE}; run eval/benchmark/extract-landmarks.mjs`);
const cache = JSON.parse(readFileSync(LANDMARK_CACHE, 'utf8'));
if (cache.tasksVision !== TASKS_VISION_VERSION || cache.modelSha256 !== MODEL_SHA256 || cache.delegate !== DELEGATE) {
  throw new Error('landmark cache was made with another runtime, model or delegate; rerun extract-landmarks.mjs');
}
if (cache.dirty && !allowDirty) throw new Error('landmark cache was extracted from a dirty tree; commit and rerun extract-landmarks.mjs');
if (cache.blockedRequestCount > 0) console.log(`extraction blocked ${cache.blockedRequestCount} requests to ${cache.blockedRequestHosts.join(', ')}`);

/** Label angles and the 68 fitted landmarks (image pixels, y down) from one .mat file. */
function readLabel(name) {
  const variables = readMatFile(readFileSync(join(AFLW2000_DIR, `${name}.mat`)));
  const pose = variables.get('Pose_Para');
  const points = variables.get('pt3d_68');
  if (!pose || pose.data.length !== 7 || !points || points.dims.join('x') !== '3x68') throw new Error(`${name}.mat lacks Pose_Para or pt3d_68`);
  const point = (k) => ({ x: points.data[3 * k], y: points.data[3 * k + 1] });
  return { angles: { pitch: pose.data[0], yaw: pose.data[1], roll: pose.data[2] }, point };
}

const intrinsicsFor = (fovDeg) => estimateIntrinsics({ width: 450, height: 450, horizontalFovDeg: fovDeg });

function solvePose(detection, fovDeg) {
  const intrinsics = estimateIntrinsics({ width: detection.width, height: detection.height, horizontalFovDeg: fovDeg });
  const imagePoints = RIGID_FACE_LANDMARKS.map(({ landmarkIndex }) => {
    const [x, y] = detection.landmarks[landmarkIndex];
    return [x * detection.width, y * detection.height];
  });
  const solved = solveHeadPose(imagePoints, RIGID_FACE_LANDMARKS, intrinsics);
  return solved.ok ? cameraRotationFromSolver(solved.rotation) : null;
}

const samples = names.map((name) => ({ name, ...readLabel(name), detection: cache.detections[name] }));
if (samples.some((s) => !s.detection)) throw new Error('landmark cache is missing images; rerun extract-landmarks.mjs');
if (samples.some((s) => s.detection.width !== 450 || s.detection.height !== 450)) throw new Error('expected 450x450 images');
const inProtocol = samples.filter((s) => withinProtocol(s.angles));
const detected = inProtocol.filter((s) => s.detection.landmarks);

const rotations = detected.map((s) => ({
  heuristic: heuristicRotation(s.detection.landmarks.map(([x, y, z]) => ({ x, y, z }))),
  mediapipeMatrix: rotationFromMediapipeMatrix(s.detection.matrix),
  solveHeadPose: solvePose(s.detection, PRIMARY_FOV_DEG),
}));
const failures = Object.fromEntries(METHODS.map((m) => [m, rotations.filter((r) => !r[m]).length]));
const evaluatedIndices = detected.map((_, i) => i).filter((i) => METHODS.every((m) => rotations[i][m]));
const evaluated = evaluatedIndices.map((i) => detected[i]);
const errorsFor = (method) => evaluatedIndices.map((i) => poseErrorsDeg(aflwAngles(rotations[i][method]), detected[i].angles));

const byYawBin = (errors) =>
  Object.fromEntries(YAW_BINS_DEG.map(([lo, hi]) => {
    const inBin = errors.filter((_, k) => {
      const yaw = Math.abs(evaluated[k].angles.yaw * DEG);
      return yaw >= lo && (yaw < hi || hi === PROTOCOL_LIMIT_DEG);
    });
    const summary = summarizePoseErrors(inBin);
    return [`${lo}-${hi}`, { n: summary.n, maeDeg: summary.maeDeg.mean, geodesicMedianDeg: summary.geodesicDeg.median }];
  }));

const methods = Object.fromEntries(METHODS.map((method) => {
  const errors = errorsFor(method);
  return [method, { failures: failures[method], ...summarizePoseErrors(errors), byAbsoluteYawDeg: byYawBin(errors) }];
}));

const sensitivity = Object.fromEntries(SENSITIVITY_FOV_DEG.map((fovDeg) => {
  const solved = evaluated.map((s) => solvePose(s.detection, fovDeg));
  const errors = solved.flatMap((rotation, k) => (rotation ? [poseErrorsDeg(aflwAngles(rotation), evaluated[k].angles)] : []));
  const summary = summarizePoseErrors(errors);
  return [fovDeg, {
    focalPx: intrinsicsFor(fovDeg).fx,
    failures: solved.length - errors.length,
    n: summary.n,
    maeDeg: summary.maeDeg,
    geodesicMedianDeg: summary.geodesicDeg.median,
  }];
}));

// Signs of the convention mapping, checked on near-frontal labels only. The
// label check uses the dataset's own fitted landmarks: positive roll tilts
// the eye line clockwise on screen, positive yaw moves the nose tip left of
// the eyes, positive pitch raises it toward them.
const nearFrontal = (s) => AXES.every((axis) => Math.abs(s.angles[axis] * DEG) <= NEAR_FRONTAL_DEG);
const frontalLabels = inProtocol.filter(nearFrontal);
const labelGeometry = (() => {
  const measures = frontalLabels.map(({ point }) => {
    const [eyeLeft, eyeRight, nose, mouthLeft, mouthRight] = [point(36), point(45), point(30), point(48), point(54)];
    const eyes = { x: (eyeLeft.x + eyeRight.x) / 2, y: (eyeLeft.y + eyeRight.y) / 2 };
    const mouthY = (mouthLeft.y + mouthRight.y) / 2;
    return {
      eyeLineAngle: Math.atan2(eyeRight.y - eyeLeft.y, eyeRight.x - eyeLeft.x),
      noseOffset: (nose.x - eyes.x) / Math.hypot(eyeRight.x - eyeLeft.x, eyeRight.y - eyeLeft.y),
      noseHeight: (nose.y - eyes.y) / (mouthY - eyes.y),
    };
  });
  const against = (axis, key) => correlation(frontalLabels.map((s) => s.angles[axis]), measures.map((m) => m[key]));
  return {
    n: frontalLabels.length,
    rollVsEyeLineAngle: { expectedSign: 1, correlation: against('roll', 'eyeLineAngle') },
    yawVsNoseOffset: { expectedSign: -1, correlation: against('yaw', 'noseOffset') },
    pitchVsNoseHeight: { expectedSign: -1, correlation: against('pitch', 'noseHeight') },
  };
})();
const frontalIndices = evaluatedIndices.filter((i) => nearFrontal(detected[i]));
const methodSigns = Object.fromEntries(METHODS.map((method) => {
  const predicted = frontalIndices.map((i) => aflwAngles(rotations[i][method]));
  const labels = frontalIndices.map((i) => detected[i].angles);
  return [method, Object.fromEntries(AXES.map((axis) => [axis, {
    correlation: correlation(labels.map((a) => a[axis]), predicted.map((a) => a[axis])),
    meanSignedErrorDeg: predicted.reduce((sum, a, k) => sum + (a[axis] - labels[k][axis]) * DEG, 0) / predicted.length,
  }]))];
}));

const entry = round({
  measuredAt: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'),
  dirty: dirty.length > 0,
  command: 'node eval/benchmark/pose-benchmark.mjs',
  hardware: {
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    os: `${platform()} ${release()}`,
    node: process.version,
    browser: cache.browser,
  },
  dataset: {
    name: 'AFLW2000-3D',
    archiveSha256: AFLW2000_SHA256,
    labels: 'Pose_Para from a 3D morphable model fit to each image, not motion capture',
  },
  protocol: `labels with any angle beyond ${PROTOCOL_LIMIT_DEG} deg excluded; images with no detected face excluded and counted; metrics over images where all three methods return a pose`,
  counts: {
    images: samples.length,
    beyondProtocolLimit: samples.length - inProtocol.length,
    inProtocol: inProtocol.length,
    noFaceInProtocol: inProtocol.length - detected.length,
    noFaceAllImages: cache.noFace,
    noFaceInProtocolByAbsoluteYawDeg: Object.fromEntries(YAW_BINS_DEG.map(([lo, hi]) => [`${lo}-${hi}`, inProtocol.filter((s) => {
      const yaw = Math.abs(s.angles.yaw * DEG);
      return !s.detection.landmarks && yaw >= lo && (yaw < hi || hi === PROTOCOL_LIMIT_DEG);
    }).length])),
    methodFailures: failures,
    evaluated: evaluated.length,
  },
  landmarks: {
    runtime: `@mediapipe/tasks-vision ${cache.tasksVision}, face_landmarker.task float16/1`,
    modelSha256: cache.modelSha256,
    delegate: cache.delegate,
    options: LANDMARKER_OPTIONS,
    extractedAtCommit: cache.commit,
    extractedFromDirtyTree: cache.dirty,
    extractionCpu: cache.cpu,
    blockedRequestCount: cache.blockedRequestCount,
  },
  fovAssumption: {
    degrees: PRIMARY_FOV_DEG,
    focalPx: intrinsicsFor(PRIMARY_FOV_DEG).fx,
    applies: 'solveHeadPose; MediaPipe fixes its own 63 deg vertical FOV; the heuristic uses none',
    model: 'square pixels, principal point at the image centre',
  },
  methods,
  sensitivity: { solveHeadPoseByFovDeg: sensitivity },
  conventionCheck: { nearFrontalLimitDeg: NEAR_FRONTAL_DEG, labelGeometry, methods: { n: frontalIndices.length, ...methodSigns } },
});

console.log(`${renderPoseTable(entry)}\n\n${renderConventionCheck(entry)}`);
const out = allowDirty && dirty.length ? join(EVAL, '.cache', 'results-dirty.json') : RESULTS;
const results = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { runs: {} };
results.runs[RESULTS_KEY] = entry;
writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
console.log(`wrote runs["${RESULTS_KEY}"] to ${out}`);
