#!/usr/bin/env node
// Measures metric scale on synthetic faces and on the webcam recordings, and
// writes runs["metric-scale"] to eval/results.json.
//
//   node eval/scale/measure.mjs --clips <dir>
//   node eval/scale/measure.mjs --clips <dir> --allow-dirty      (writes eval/.cache/results-dirty.json)
//   node eval/scale/measure.mjs --clips <dir> --keep-landmarks   (keeps the cached landmark tracks)
//
// The recordings' landmark tracks are cached under eval/.cache while the
// script runs and deleted when it ends, also on failure, unless
// --keep-landmarks is passed.
//
// <dir> holds rec-static.y4m and rec-blink.y4m (eval/fixtures/build.mjs
// --source recordings). PD, face width and face scale are biometric: for
// recorded clips the entry holds only the fields in RECORDED_CLIP_FIELDS
// (summary.mjs), which together cannot rebuild any of them, and the script
// refuses to write anything else. Synthetic faces report absolute error
// against their known truth.
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
  aggregateFaceMeasurements,
  estimateIntrinsics,
  mat3Multiply,
  mat3Transpose,
  rotationMatrixFromVector,
  rotationVectorFromMatrix,
  solveHeadPose,
} from '../../packages/cv/src/index.ts';
import { seededRandom } from '../../packages/cv/test/random.ts';
import {
  ASSUMED_INTRINSICS,
  conversionCoverage,
  fixedFocalCoverage,
  measureSyntheticFrames,
  noiseOnlyCoverage,
  populationCoverage,
} from '../../packages/cv/test/scaleExperiments.ts';
import { AVERAGE_SUBJECT } from '../../packages/cv/test/syntheticFace.ts';
import { projectWithNoise } from '../../packages/cv/test/syntheticPose.ts';
import { CLIP_LANDMARKER_OPTIONS, clipLandmarks, discardClipLandmarks } from './clipLandmarks.mjs';
import { assertRecordingsFields, medianChangePercent, recordClip } from './summary.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = join(EVAL, 'results.json');
const RESULTS_KEY = 'metric-scale';
const CLIPS = ['rec-static', 'rec-blink'];
/** The app's assumed horizontal field of view (frontend/src/geometry/headPose.ts). */
const APP_FOV_DEG = 60;
const DEG = Math.PI / 180;
const RECORDINGS_PRIVACY =
  'counts, frame-to-frame SDs in percent, 95% half-widths rounded to whole percent, clip-to-clip median agreement and dimensionless landmark diagnostics; nothing that depends on depth or focal length, so no PD, face width or face scale can be rebuilt';

export function parseMeasureArgs(argv) {
  const i = argv.indexOf('--clips');
  return {
    clipsDir: resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : join(EVAL, '.cache', 'clips', 'recordings')),
    allowDirty: argv.includes('--allow-dirty'),
    keepLandmarks: argv.includes('--keep-landmarks'),
  };
}
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
        // A frame whose scale comes from one eye has twice the iris variance.
        const singleEyeFrames = run.frames.filter((frame) => frame.irisDiameterRatio === null).length;
        const singleEyeShare = singleEyeFrames / run.frames.length;
        const summarize = (values, truth, extraPoints) => {
          const lengthPx = (intrinsics.fx * truth) / run.truth.eyeDepthMm;
          return {
            truthMm: round(truth, 2),
            medianErrorMm: round(median(values) - truth),
            medianErrorPercent: round(100 * (median(values) / truth - 1)),
            frameSdPercent: round((100 * sd(values)) / truth),
            predictedFrameSdPercent: round(100 * sigmaPx * Math.sqrt((1 + singleEyeShare) / irisPx ** 2 + extraPoints / lengthPx ** 2)),
          };
        };
        rows.push({
          sigmaPx,
          depthMm,
          yawDeg,
          frames: run.frames.length,
          bothIrisesInconsistent: run.failures,
          singleEyeFrames,
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

/**
 * PD and face width on a wearer who squints throughout: the lids at 0.2 and
 * 0.17 of the eye width, with the iris contour 4% and 6% narrow, as
 * MediaPipe's reads between half and 0.9 of the open-eye openness
 * (irisWidthByRelativeOpenness). The openness gate is relative to the clip
 * median, so it keeps these frames.
 */
function syntheticSquint() {
  const pose = poseAt(2, 3, 0, [0, 0, 550]);
  return [[0.2, 0.04], [0.17, 0.06]].map(([eyeOpenness, irisShrink], k) => {
    const run = measureSyntheticFrames(AVERAGE_SUBJECT, pose, 0.5, 60, seededRandom(8100 + k), ASSUMED_INTRINSICS, ASSUMED_INTRINSICS, { eyeOpenness, irisShrink });
    const summary = aggregateFaceMeasurements(run.results);
    if (!summary.ok) throw new Error(`squint run failed: ${summary.reason}`);
    const covers = (interval, truth) => interval.lowerMm <= truth && truth <= interval.upperMm;
    return {
      eyeOpenness,
      irisShrink,
      acceptedFrames: summary.acceptedFrames,
      nearPdErrorPercent: round(100 * (summary.nearPupillaryDistance.medianMm / run.truth.nearPdMm - 1), 2),
      faceWidthErrorPercent: round(100 * (summary.faceWidth.medianMm / run.truth.faceWidthMm - 1), 2),
      intervalsCoverTruth: covers(summary.nearPupillaryDistance, run.truth.nearPdMm) && covers(summary.faceWidth, run.truth.faceWidthMm),
    };
  });
}

/**
 * Face-width coverage for cameras outside the assumed focal spread: an
 * 85 degree webcam (focal length 0.63 times the 60 degree one) and a
 * portrait 720x1280 frame whose 60 degrees span the long side, while the app
 * assumes them across the width (1.78 times).
 */
function syntheticFocalOutsideAssumption() {
  const wide = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 85 });
  const portraitAssumed = estimateIntrinsics({ width: 720, height: 1280, horizontalFovDeg: 60 });
  const portraitTrueFx = 640 / Math.tan(30 * DEG);
  return Object.fromEntries(
    [['webcam85Deg', wide.fx / ASSUMED_INTRINSICS.fx], ['portrait720x1280', portraitTrueFx / portraitAssumed.fx]].map(([name, focalRatio], k) => [
      name,
      { focalRatio: round(focalRatio), ...fixedFocalCoverage(400, 7020 + k, focalRatio) },
    ]),
  );
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
    const { summary, record } = recordClip(frames, width, height, APP_FOV_DEG);
    summaries[name] = summary;
    clips[name] = {
      clipSha256: extraction.clipSha256,
      size: [width, height],
      fps: extraction.fps,
      landmarksExtractedAtCommit: extraction.commit,
      landmarksExtractedFromDirtyTree: extraction.dirty,
      ...record,
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
  const { clipsDir, allowDirty, keepLandmarks } = parseMeasureArgs(process.argv.slice(2));
  const dirty = git('status', '--porcelain').split('\n').filter((line) => line && !line.endsWith('eval/results.json'));
  if (dirty.length && !allowDirty) throw new Error(`refusing to record from a dirty tree:\n${dirty.join('\n')}`);

  let recorded;
  try {
    recorded = await recordings(clipsDir);
  } finally {
    if (!keepLandmarks) console.log(`discarded cached landmarks: ${discardClipLandmarks(CLIPS).join(', ') || 'none'}`);
  }
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
      privacy: RECORDINGS_PRIVACY,
      ...recorded,
    },
    synthetic: {
      truth: 'rendered canonical face with known iris diameter, PD and face width; seeded noise',
      accuracy: syntheticAccuracy(),
      focalSensitivity: syntheticFocalSensitivity(),
      squint: syntheticSquint(),
      coverage: {
        nominal: 0.95,
        population: populationCoverage(1000, 7001),
        noiseOnly: noiseOnlyCoverage(600, 7002),
        distancePdConversion: {
          withConversionSd: conversionCoverage(600, 7010).distance,
          withoutConversionSd: conversionCoverage(600, 7010, (frame) => ({ ...frame, distancePdCorrectionSdMm: 0 })).distance,
        },
        focalOutsideAssumption: syntheticFocalOutsideAssumption(),
      },
      poseCovarianceOverMonteCarloSd: poseCovarianceCheck(),
    },
  };

  assertRecordingsFields(entry.recordings);
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
