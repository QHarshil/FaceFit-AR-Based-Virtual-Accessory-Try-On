#!/usr/bin/env node
// Measures metric scale on synthetic faces and on the webcam recordings, and
// writes runs["metric-scale"] to eval/results.json.
//
//   node eval/scale/measure.mjs --clips <dir>
//   node eval/scale/measure.mjs --clips <dir> --allow-dirty   (writes eval/.cache/results-dirty.json)
//
// <dir> holds rec-static.y4m and rec-blink.y4m (eval/fixtures/build.mjs
// --source recordings). PD and face width are biometric: for recorded clips
// the entry holds frame counts, relative spreads and relative interval
// widths, never a value in millimetres. Synthetic faces report absolute
// error against their known truth.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FACE_MEASUREMENT_LIMITS,
  FOCAL_LENGTH_RELATIVE_SD,
  IRIS_PLANE_OFFSET_MM,
  IRIS_PLANE_OFFSET_SD_MM,
  POPULATION_IRIS_DIAMETER_MM,
  PUPIL_TO_ROTATION_CENTRE_MM,
  PUPIL_TO_ROTATION_CENTRE_SD_MM,
  RIGID_FACE_LANDMARKS,
  estimateIntrinsics,
  mat3Multiply,
  mat3Transpose,
  rotationMatrixFromVector,
  rotationVectorFromMatrix,
  solveHeadPose,
} from '../../packages/cv/src/index.ts';
import { seededRandom } from '../../packages/cv/test/random.ts';
import { measureSyntheticFrames, noiseOnlyCoverage, populationCoverage } from '../../packages/cv/test/scaleExperiments.ts';
import { AVERAGE_SUBJECT } from '../../packages/cv/test/syntheticFace.ts';
import { projectWithNoise } from '../../packages/cv/test/syntheticPose.ts';
import { CLIP_LANDMARKER_OPTIONS, clipLandmarks } from './clipLandmarks.mjs';
import { clipRecord, landmarkDiagnostics, measureClip, medianChangePercent } from './summary.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = join(EVAL, 'results.json');
const RESULTS_KEY = 'metric-scale';
const CLIPS = ['rec-static', 'rec-blink'];
/** The app's assumed horizontal field of view (frontend/src/geometry/headPose.ts). */
const APP_FOV_DEG = 60;
const DEG = Math.PI / 180;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const git = (...args) => execFileSync('git', ['-C', EVAL, ...args], { encoding: 'utf8' }).trim();
const round = (value, digits = 3) => Number(value.toFixed(digits));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
};
const sd = (values) => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
};

function poseAt(yawDeg, pitchDeg, rollDeg, translationMm) {
  const yaw = rotationMatrixFromVector([0, yawDeg * DEG, 0]);
  const pitch = rotationMatrixFromVector([pitchDeg * DEG, 0, 0]);
  const roll = rotationMatrixFromVector([0, 0, rollDeg * DEG]);
  return { rotation: mat3Multiply(roll, mat3Multiply(yaw, pitch)), translationMm };
}

/**
 * Per-frame SD and median error of PD and face width on synthetic faces of
 * known size, against the first-principles SD the cv tests bound them by.
 */
function syntheticAccuracy() {
  const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 });
  const subject = { ...AVERAGE_SUBJECT, faceScale: 1.06, distancePdMm: 64.5 };
  const rows = [];
  for (const sigmaPx of [0.5, 1]) {
    for (const depthMm of [450, 650, 900]) {
      for (const yawDeg of [0, 8]) {
        const pose = poseAt(yawDeg, 5, 10, [30, -20, depthMm]);
        const run = measureSyntheticFrames(subject, pose, sigmaPx, 300, seededRandom(depthMm + yawDeg * 7 + sigmaPx * 1000), intrinsics);
        const irisPx = (intrinsics.fx * 11.7) / run.truth.eyeDepthMm;
        const summarize = (values, truth, extraPoints) => {
          const lengthPx = (intrinsics.fx * truth) / run.truth.eyeDepthMm;
          return {
            truthMm: round(truth, 2),
            medianErrorMm: round(median(values) - truth),
            medianErrorPercent: round(100 * (median(values) / truth - 1)),
            frameSdPercent: round((100 * sd(values)) / truth),
            predictedFrameSdPercent: round(100 * sigmaPx * Math.sqrt(1 / irisPx ** 2 + extraPoints / lengthPx ** 2)),
          };
        };
        rows.push({
          sigmaPx,
          depthMm,
          yawDeg,
          frames: run.frames.length,
          bothIrisesInconsistent: run.failures,
          nearPupillaryDistance: summarize(run.frames.map((f) => f.nearPdMm), run.truth.nearPdMm, 0.4375),
          distancePupillaryDistance: summarize(run.frames.map((f) => f.distancePdMm), run.truth.distancePdMm, 0.4375),
          faceWidth: summarize(run.frames.map((f) => f.faceWidthMm), run.truth.faceWidthMm, 2),
        });
      }
    }
  }
  return rows;
}

/** Relative change of PD and face width on one exact synthetic frame when the focal length is assumed wrong. */
function syntheticFocalSensitivity() {
  const truthCamera = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 });
  const subject = { ...AVERAGE_SUBJECT, faceScale: 1.06, distancePdMm: 64.5 };
  const pose = poseAt(5, 8, -6, [20, 10, 600]);
  const frameWith = (camera) => measureSyntheticFrames(subject, pose, 0, 1, seededRandom(81), truthCamera, camera).frames[0];
  const right = frameWith(truthCamera);
  return Object.fromEntries([50, 75].map((fov) => {
    const camera = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: fov });
    const off = frameWith(camera);
    return [`assumed${fov}DegForTrue62`, {
      focalChangePercent: round(100 * (camera.fx / truthCamera.fx - 1), 1),
      nearPdChangePercent: round(100 * (off.nearPdMm / right.nearPdMm - 1)),
      faceWidthChangePercent: round(100 * (off.faceWidthMm / right.faceWidthMm - 1)),
      irisDepthChangePercent: round(100 * (off.irisDepthMm / right.irisDepthMm - 1)),
    }];
  }));
}

/** Reported pose SD over the Monte Carlo SD, per axis, over 1,000 noisy solves of three fixed poses. */
function poseCovarianceCheck() {
  const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 });
  const poses = [poseAt(0, 0, 0, [0, 0, 500]), poseAt(30, -10, 5, [60, -40, 700]), poseAt(-8, 20, -15, [-30, 20, 400])];
  const trials = 1000;
  return Object.fromEntries([0.5, 1, 2].map((sigmaPx) => {
    const rotationRatios = [];
    const translationRatios = [];
    poses.forEach((truth, p) => {
      const random = seededRandom(9100 + sigmaPx * 10 + p);
      const errors = Array.from({ length: 6 }, () => []);
      const reported = Array.from({ length: 6 }, () => []);
      for (let t = 0; t < trials; t++) {
        const solved = solveHeadPose(projectWithNoise(truth, RIGID_FACE_LANDMARKS, intrinsics, sigmaPx, random), RIGID_FACE_LANDMARKS, intrinsics);
        if (!solved.ok || !solved.uncertainty) throw new Error('synthetic solve failed');
        const rotationError = rotationVectorFromMatrix(mat3Multiply(solved.rotation, mat3Transpose(truth.rotation)));
        for (let axis = 0; axis < 3; axis++) {
          errors[axis].push(rotationError[axis] / DEG);
          errors[axis + 3].push(solved.translationMm[axis] - truth.translationMm[axis]);
          reported[axis].push(solved.uncertainty.rotationStdDeg[axis]);
          reported[axis + 3].push(solved.uncertainty.translationStdMm[axis]);
        }
      }
      for (let d = 0; d < 6; d++) (d < 3 ? rotationRatios : translationRatios).push(median(reported[d]) / sd(errors[d]));
    });
    return [`${sigmaPx}px`, {
      rotationRatio: [round(Math.min(...rotationRatios)), round(Math.max(...rotationRatios))],
      translationRatio: [round(Math.min(...translationRatios)), round(Math.max(...translationRatios))],
    }];
  }));
}

async function recordings(clipsDir) {
  const clips = {};
  const summaries = {};
  let extraction = null;
  for (const name of CLIPS) {
    const path = join(clipsDir, `${name}.y4m`);
    if (!existsSync(path)) throw new Error(`${path} not found; build the recording clips with eval/fixtures/build.mjs --source recordings`);
    extraction = await clipLandmarks(path, (line) => process.stdout.write(`\r${line}   `));
    const { frames, width, height } = extraction;
    const summary = measureClip(frames, width, height, APP_FOV_DEG);
    summaries[name] = summary;
    clips[name] = {
      clipSha256: extraction.clipSha256,
      size: [width, height],
      fps: extraction.fps,
      landmarksExtractedAtCommit: extraction.commit,
      landmarksExtractedFromDirtyTree: extraction.dirty,
      ...clipRecord(summary, frames.length),
      landmarkDiagnostics: landmarkDiagnostics(frames, width, height),
      focalSensitivity: Object.fromEntries([50, 70].map((fov) => [
        `assumed${fov}Deg`,
        medianChangePercent(summary, measureClip(frames, width, height, fov)),
      ])),
    };
  }
  process.stdout.write('\n');
  return {
    clips,
    blinkAgainstStaticMedianChangePercent: medianChangePercent(summaries['rec-static'], summaries['rec-blink']),
    landmarks: {
      runtime: `@mediapipe/tasks-vision ${extraction.tasksVision}, face_landmarker.task float16/1, ${extraction.delegate} delegate`,
      modelSha256: extraction.modelSha256,
      options: CLIP_LANDMARKER_OPTIONS,
      browser: extraction.browser,
      blockedRequestCount: extraction.blockedRequestCount,
    },
  };
}

async function main() {
  const allowDirty = process.argv.includes('--allow-dirty');
  const clipsDir = resolve(arg('clips', join(EVAL, '.cache', 'clips', 'recordings')));
  const dirty = git('status', '--porcelain').split('\n').filter((line) => line && !line.endsWith('eval/results.json'));
  if (dirty.length && !allowDirty) throw new Error(`refusing to record from a dirty tree:\n${dirty.join('\n')}`);

  const recorded = await recordings(clipsDir);
  console.log('synthetic accuracy, coverage and pose covariance ...');
  const entry = {
    measuredAt: new Date().toISOString(),
    commit: git('rev-parse', 'HEAD'),
    dirty: dirty.length > 0,
    command: 'node eval/scale/measure.mjs --clips <dir>',
    hardware: {
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      memoryGB: Math.round(totalmem() / 2 ** 30),
      os: `${platform()} ${release()}`,
      node: process.version,
      browser: recorded.landmarks.browser,
    },
    assumptions: {
      horizontalFovDeg: APP_FOV_DEG,
      irisDiameterMm: POPULATION_IRIS_DIAMETER_MM,
      irisPlaneOffsetMm: { mean: IRIS_PLANE_OFFSET_MM, sd: IRIS_PLANE_OFFSET_SD_MM },
      pupilToRotationCentreMm: { mean: PUPIL_TO_ROTATION_CENTRE_MM, sd: PUPIL_TO_ROTATION_CENTRE_SD_MM },
      focalLengthRelativeSd: FOCAL_LENGTH_RELATIVE_SD,
      limits: DEFAULT_FACE_MEASUREMENT_LIMITS,
    },
    recordings: {
      privacy: 'counts, relative spreads and relative interval half-widths only; no PD, face width or face scale is recorded',
      ...recorded,
    },
    synthetic: {
      truth: 'rendered canonical face with known iris diameter, PD and face width; seeded noise',
      accuracy: syntheticAccuracy(),
      focalSensitivity: syntheticFocalSensitivity(),
      coverage: {
        nominal: 0.95,
        population: populationCoverage(1000, 7001),
        noiseOnly: noiseOnlyCoverage(600, 7002),
      },
      poseCovarianceOverMonteCarloSd: poseCovarianceCheck(),
    },
  };

  for (const [name, clip] of Object.entries(entry.recordings.clips)) {
    const line = clip.ok
      ? `accepted ${clip.acceptedFrames}/${clip.frames}; near PD frame SD ${clip.nearPupillaryDistance.frameSdPercent}%, 95% half-width ${clip.nearPupillaryDistance.halfWidthPercent}%; face width frame SD ${clip.faceWidth.frameSdPercent}%, half-width ${clip.faceWidth.halfWidthPercent}%`
      : `not measured: ${clip.reason}`;
    console.log(`${name}: ${line}; rejected ${JSON.stringify(clip.rejectedFrames)}`);
  }
  const { population, noiseOnly } = entry.synthetic.coverage;
  console.log(`synthetic coverage: population near ${population.near}, distance ${population.distance}, width ${population.width}; noise only near ${noiseOnly.near}`);

  const out = allowDirty && dirty.length ? join(EVAL, '.cache', 'results-dirty.json') : RESULTS;
  const results = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { runs: {} };
  results.runs[RESULTS_KEY] = entry;
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`wrote runs["${RESULTS_KEY}"] to ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
