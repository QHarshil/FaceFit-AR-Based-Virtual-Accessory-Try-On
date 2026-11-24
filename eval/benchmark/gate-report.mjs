#!/usr/bin/env node
// Share of frames the overlay gate hides, by absolute yaw on AFLW2000-3D and
// by distance on synthetic faces. Merges runs["pose-gate-report"] into
// eval/results.json.
//
//   node eval/benchmark/gate-report.mjs                 refuses a dirty working tree
//   node eval/benchmark/gate-report.mjs --allow-dirty   writes eval/.cache/results-dirty.json instead
//
// Needs the AFLW2000 landmark cache from extract-landmarks.mjs. The gate runs
// per image, without the hysteresis a video has, so each share is that of
// frames that would hide a shown overlay. The synthetic faces have a shape
// mismatch set so that their median reprojection RMS at 600 mm matches the
// still clip's (runs["pose-integration"]), and fixed pixel noise: a model,
// with its assumptions in gateShare.mjs and docs/geometry.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seededRandom } from '../../packages/cv/test/random.ts';
import { AFLW2000_DIR, aflw2000Samples } from '../datasets/download-aflw2000.mjs';
import { DELEGATE, LANDMARK_CACHE, MODEL_SHA256, TASKS_VISION_VERSION } from './extract-landmarks.mjs';
import { GATE, gateDetection, summarizeOutcomes, syntheticOutcome } from './gateShare.mjs';
import { readMatFile } from './matFile.mjs';
import { PROTOCOL_LIMIT_DEG, withinProtocol } from './poseMetrics.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(EVAL, '..');
const RESULTS = join(EVAL, 'results.json');
export const RESULTS_KEY = 'pose-gate-report';
const YAW_BINS_DEG = [[0, 15], [15, 30], [30, 45], [45, 60], [60, 75], [75, PROTOCOL_LIMIT_DEG]];
const DISTANCES_MM = [400, 600, 800, 1000, 1500, 2000, 2500, 3000];
const PIXEL_SIGMAS = [0, 0.5, 1, 2];
const FACES_PER_DISTANCE = 400;
const CALIBRATION_DEPTH_MM = 600;
const DEG = 180 / Math.PI;

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
const round = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v)));

const allowDirty = process.argv.includes('--allow-dirty');
const dirty = git('status', '--porcelain').split('\n').filter((line) => line && !line.endsWith('eval/results.json'));
if (dirty.length && !allowDirty) {
  console.error(`working tree is dirty; commit first or pass --allow-dirty\n${dirty.join('\n')}`);
  process.exit(1);
}

const results = JSON.parse(readFileSync(RESULTS, 'utf8'));

// AFLW2000: every image within the protocol, binned by its label's absolute yaw.
const cache = JSON.parse(readFileSync(LANDMARK_CACHE, 'utf8'));
if (cache.tasksVision !== TASKS_VISION_VERSION || cache.modelSha256 !== MODEL_SHA256 || cache.delegate !== DELEGATE) {
  throw new Error('landmark cache was made with another runtime, model or delegate; rerun extract-landmarks.mjs');
}
if (cache.dirty && !allowDirty) throw new Error('landmark cache was extracted from a dirty tree; commit and rerun extract-landmarks.mjs');
const samples = aflw2000Samples().map((name) => {
  const pose = readMatFile(readFileSync(join(AFLW2000_DIR, `${name}.mat`))).get('Pose_Para');
  return { name, angles: { pitch: pose.data[0], yaw: pose.data[1], roll: pose.data[2] }, detection: cache.detections[name] };
});
const inProtocol = samples.filter((s) => withinProtocol(s.angles));
const aflwBins = Object.fromEntries(YAW_BINS_DEG.map(([lo, hi]) => {
  const inBin = inProtocol.filter((s) => {
    const yaw = Math.abs(s.angles.yaw * DEG);
    return yaw >= lo && (yaw < hi || hi === PROTOCOL_LIMIT_DEG);
  });
  const detected = inBin.filter((s) => s.detection.landmarks);
  return [`${lo}-${hi}`, summarizeOutcomes(detected.map((s) => gateDetection(s.detection)), inBin.length - detected.length)];
}));
const aflwAll = summarizeOutcomes(
  inProtocol.filter((s) => s.detection.landmarks).map((s) => gateDetection(s.detection)),
  inProtocol.filter((s) => !s.detection.landmarks).length,
);

// Synthetic faces. The shape mismatch is found by bisection so the median RMS
// at the calibration depth without pixel noise equals the still clip's.
const stillRmsMm = results.runs['pose-integration'].summary.solver.byCondition.still.rmsReprojectionMm.p50;
const medianRms = (depthMm, shapeSigmaMm, pixelSigma, seed) => {
  const random = seededRandom(seed);
  const rms = Array.from({ length: FACES_PER_DISTANCE }, () => syntheticOutcome(random, depthMm, shapeSigmaMm, pixelSigma).rmsMm)
    .filter((v) => v != null)
    .sort((a, b) => a - b);
  return rms[Math.floor(rms.length / 2)];
};
let lo = 0;
let hi = 20;
for (let i = 0; i < 30; i += 1) {
  const mid = (lo + hi) / 2;
  if (medianRms(CALIBRATION_DEPTH_MM, mid, 0, 1) < stillRmsMm) lo = mid;
  else hi = mid;
}
const shapeSigmaMm = (lo + hi) / 2;
const synthetic = Object.fromEntries(PIXEL_SIGMAS.map((pixelSigma, k) => [`${pixelSigma}px`, Object.fromEntries(DISTANCES_MM.map((depthMm, d) => {
  const random = seededRandom(1000 + 100 * k + d);
  const outcomes = Array.from({ length: FACES_PER_DISTANCE }, () => syntheticOutcome(random, depthMm, shapeSigmaMm, pixelSigma));
  return [depthMm, summarizeOutcomes(outcomes)];
}))]));

const entry = round({
  measuredAt: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'),
  dirty: dirty.length > 0,
  command: `node eval/benchmark/gate-report.mjs ${process.argv.slice(2).join(' ')}`.trim(),
  hardware: { cpu: cpus()[0].model },
  gate: { ...GATE, rule: 'hide when the solve fails, the face points away, or the reprojection RMS times depth over focal length exceeds hideAboveMm; a hidden overlay shows again below showBelowMm' },
  aflw2000: {
    landmarks: `@mediapipe/tasks-vision ${cache.tasksVision}, IMAGE mode, ${cache.delegate} delegate, extracted at ${cache.commit}`,
    pixels: 'normalized landmarks times 450, intrinsics from the app FOV',
    imagesInProtocol: inProtocol.length,
    all: aflwAll,
    byAbsoluteYawDeg: aflwBins,
  },
  synthetic: {
    model: `canonical rigid landmarks moved by isotropic Gaussian shape noise of ${shapeSigmaMm.toFixed(3)} mm (median RMS ${stillRmsMm} mm at ${CALIBRATION_DEPTH_MM} mm without pixel noise, the still clip median), poses within 30 deg yaw, 20 pitch and 15 roll, 1280x720 at ${GATE.horizontalFovDeg} deg, fixed Gaussian pixel noise per landmark`,
    shapeSigmaMm,
    facesPerDistance: FACES_PER_DISTANCE,
    byPixelSigmaAndDistanceMm: synthetic,
  },
});

const out = dirty.length ? join(EVAL, '.cache', 'results-dirty.json') : RESULTS;
const target = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { runs: {} };
target.runs[RESULTS_KEY] = entry;
writeFileSync(out, `${JSON.stringify(target, null, 2)}\n`);
console.log(`wrote ${out}`);
