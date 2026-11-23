// Solve time for solveHeadPose in Node. Merges its entry into
// eval/results.json, the repository's single record of measured numbers.
// Reports numbers; asserts nothing.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { estimateIntrinsics } from '../src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../src/faceModel.ts';
import { mat3Multiply, type Vec2 } from '../src/linalg.ts';
import { solveHeadPose, type HeadPose } from '../src/pnp.ts';
import { rotationMatrixFromVector } from '../src/rotation.ts';
import { seededRandom } from '../test/random.ts';
import { percentile, projectWithNoise, sampleHeadPose } from '../test/syntheticPose.ts';

const RESULTS_KEY = 'cv-solveHeadPose';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const RESULTS = fileURLToPath(new URL('../../../eval/results.json', import.meta.url));
const SOLVES = 1000;
const WARMUP_SOLVES = 200;
const SIGMA_PX = 1;
/** Per-frame motion for the tracking run: about 0.6 deg and 2 mm RMS per axis. */
const FRAME_ROTATION_STD_RAD = 0.01;
const FRAME_TRANSLATION_STD_MM = 2;

const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 });
if (!intrinsics) throw new Error('invalid bench intrinsics');

function git(...args: string[]): string {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
}

function timeSolves(frames: readonly Vec2[][], warmStart: boolean): number[] {
  const micros: number[] = [];
  let previous: HeadPose | undefined;
  for (const pixels of frames) {
    const options = warmStart && previous ? { initialPose: previous } : {};
    const start = performance.now();
    const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics!, options);
    micros.push((performance.now() - start) * 1000);
    if (!solved.ok) throw new Error(`bench solve failed: ${solved.reason}`);
    previous = solved;
  }
  return micros;
}

const random = seededRandom(2026);
const independentFrames = Array.from({ length: SOLVES }, () =>
  projectWithNoise(sampleHeadPose(random, intrinsics), RIGID_FACE_LANDMARKS, intrinsics, SIGMA_PX, random),
);
let pose = sampleHeadPose(random, intrinsics);
const trackingFrames = Array.from({ length: SOLVES }, () => {
  const step = rotationMatrixFromVector([
    random.gaussian(FRAME_ROTATION_STD_RAD),
    random.gaussian(FRAME_ROTATION_STD_RAD),
    random.gaussian(FRAME_ROTATION_STD_RAD),
  ]);
  pose = {
    rotation: mat3Multiply(step, pose.rotation),
    translationMm: [
      pose.translationMm[0] + random.gaussian(FRAME_TRANSLATION_STD_MM),
      pose.translationMm[1] + random.gaussian(FRAME_TRANSLATION_STD_MM),
      Math.min(900, Math.max(350, pose.translationMm[2] + random.gaussian(FRAME_TRANSLATION_STD_MM))),
    ],
  };
  return projectWithNoise(pose, RIGID_FACE_LANDMARKS, intrinsics, SIGMA_PX, random);
});

// A number in eval/results.json must come from a committed tree; the results file itself may differ.
const dirty = git('status', '--porcelain')
  .split('\n')
  .some((line) => line && !line.endsWith('eval/results.json'));
timeSolves(independentFrames.slice(0, WARMUP_SOLVES), false);
const cold = timeSolves(independentFrames, false);
const tracking = timeSolves(trackingFrames, true);

const summary = (micros: number[]) => ({
  n: micros.length,
  p50Us: Number(percentile(micros, 0.5).toFixed(1)),
  p95Us: Number(percentile(micros, 0.95).toFixed(1)),
});
const entry = {
  measuredAt: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'),
  dirty,
  command: 'npm run bench (packages/cv)',
  hardware: {
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.platform()} ${os.release()}`,
    node: process.version,
  },
  setup: {
    solves: SOLVES,
    warmupSolves: WARMUP_SOLVES,
    landmarks: RIGID_FACE_LANDMARKS.length,
    sigmaPx: SIGMA_PX,
    intrinsics: '1280x720, 62 deg horizontal FOV',
    independentPoses: 'yaw +-45, pitch +-30, roll +-30 deg, 350 to 900 mm',
    trackingPoses: 'random walk from one sampled pose, 0.01 rad and 2 mm per axis per frame',
  },
  independentFrames: summary(cold),
  trackingWithWarmStart: summary(tracking),
};

console.log(JSON.stringify(entry, null, 2));
if (dirty) {
  console.error(`working tree is dirty; commit first. ${RESULTS} not updated.`);
  process.exitCode = 1;
} else {
  const results = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : { runs: {} };
  results.runs[RESULTS_KEY] = entry;
  writeFileSync(RESULTS, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`wrote runs["${RESULTS_KEY}"] to ${RESULTS}`);
}
