#!/usr/bin/env node
// Sweeps the parameters of both pose filters by replaying runs recorded with
// the filter off (poseReplay.mjs), one run per MediaPipe configuration, and
// merges runs["pose-filter-sweep"] into eval/results.json.
//
//   node eval/harness/poseFilterSweep.mjs --runs pose-filter-off,pose-filter-off-2faces
//   node eval/harness/poseFilterSweep.mjs --runs ... --allow-dirty   (writes eval/.cache/results-dirty.json)
//
// Each label names a baseline.mjs run in results.json and its raw runs in
// eval/.cache/runs/<label>/. Rotation and translation are swept in turn: the
// rotation parameters against rotation jitter on rec-static and the delay on
// the roll sinusoid, then the translation parameters, with the chosen
// rotation, against position jitter and the position lag, the larger of the
// lag to 90% on the step and the delay on the ramp. Each stage's operating
// point is the least jitter among points with a lag under the target, or the
// least lag when none is. results.json keeps each stage's Pareto front and
// operating point; the script and the cached runs reproduce the full grid.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oneEuroPose, poseKalman } from '../../packages/cv/src/index.ts';
import { FRAME, MOTION, motionTruth } from './conditions.mjs';
import { blinkShift, findBlinks, lineAngle, median, outsideBlinks, renderedJitter, rotationJitter, sampleGeometry, shownPoses } from './metrics.mjs';
import { motionMetrics, presentationRate, presentedFrames, renderedSamples } from './motionMetrics.mjs';
import { replayRun } from './poseReplay.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(EVAL, '..');
const RESULTS = join(EVAL, 'results.json');
export const SWEEP_KEY = 'pose-filter-sweep';

// The step lag target also bounds the ramp delay and the roll delay: a step
// alone rewards a filter that is fast on large jumps and slow at moderate
// speed, and the roll clip is the only rotation motion.
export const TARGETS = { rotationJitterDeg: 0.1, positionJitterPx: 0.5, lagMs: 50 };

const ONE_EURO_GRID = {
  minCutoffHz: [0.05, 0.1, 0.2, 0.4, 0.7, 1, 1.5, 2.5],
  rotationBeta: [0, 0.3, 1, 3, 10, 30],
  translationBeta: [0, 0.003, 0.01, 0.03, 0.1, 0.3],
  derivativeCutoffHz: [0.5, 1, 2, 4],
};
const geometric = (from, to, count) => Array.from({ length: count }, (_, i) => from * (to / from) ** (i / (count - 1)));
const KALMAN_GRID = {
  angularAccelerationNoise: geometric(0.003, 30, 13),
  linearAccelerationNoiseMm: geometric(0.3, 3000, 13),
};

const CONDITIONS = ['still', 'rec-static', 'rec-blink', 'step-x', 'ramp-x', 'sine-roll'];

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
const round = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'number' ? Number(v.toPrecision(4)) : v)));

export const loadRuns = (label) => {
  const dir = join(EVAL, '.cache', 'runs', label);
  return Object.fromEntries(CONDITIONS.map((id) => {
    const file = join(dir, `${id}.json`);
    if (!existsSync(file)) throw new Error(`missing ${file}; record it with baseline.mjs --pose-filter off --label ${label}`);
    return [id, JSON.parse(readFileSync(file, 'utf8'))];
  }));
};

// What the recorded run needs beyond the replay: blink masks, presented
// frames with their truth, and the raw pose noise that sets the Kalman
// measurement noise.
export const prepare = (runs) => {
  const blinksOf = (run) => {
    const poses = shownPoses(run.events);
    const openness = poses.map((e) => sampleGeometry(e, run.environment.video, run.environment.viewport).eyeOpenness);
    return { poseTimes: poses.map((e) => e.t), blinks: findBlinks(openness), count: poses.length };
  };
  const motion = Object.fromEntries(MOTION.map((condition) => {
    const run = runs[condition.id];
    const frames = presentedFrames(run.events, run.frameCodes);
    return [condition.id, { condition, frames, fps: presentationRate(frames, condition.clipSeconds * FRAME.fps) }];
  }));
  return { still: blinksOf(runs.still), recStatic: blinksOf(runs['rec-static']), recBlink: blinksOf(runs['rec-blink']), motion };
};

/**
 * Measurement noise of the solved pose on rec-static: the RMS distance from a
 * centred moving average of five samples, outside blinks, scaled by
 * sqrt(5 / 4) because subtracting a five-sample mean removes a fifth of the
 * variance of white noise. Rotation is split evenly over three axes.
 */
export const solvedPoseNoise = (run) => {
  const poses = shownPoses(run.events);
  const openness = poses.map((e) => sampleGeometry(e, run.environment.video, run.environment.viewport).eyeOpenness);
  const keep = outsideBlinks(poses.length, findBlinks(openness)).map((i) => poses[i]);
  const window = 5;
  const half = Math.floor(window / 2);
  const correction = Math.sqrt(window / (window - 1));
  const axis = (k) => {
    const xs = keep.map((e) => e.headPose.translationMm[k]);
    let sum = 0;
    let n = 0;
    for (let i = half; i < xs.length - half; i += 1) {
      const mean = xs.slice(i - half, i + half + 1).reduce((s, v) => s + v, 0) / window;
      sum += (xs[i] - mean) ** 2;
      n += 1;
    }
    return Math.sqrt(sum / n) * correction;
  };
  const rotationDeg = rotationJitter(keep.map((e) => e.headPose.quaternion), window).rmsHighPass * correction;
  return { translationMm: [axis(0), axis(1), axis(2)], rotationRad: ((rotationDeg / Math.sqrt(3)) * Math.PI) / 180 };
};

const asRenderEvents = (renders) => renders.map((r) => ({ stage: 'renderedPose', t: r.t, centerPx: r.centerPx, endsPx: r.endsPx }));

/** Every sweep metric for one filter on one MediaPipe configuration. */
export const evaluate = (runs, prepared, createFilter) => {
  const replays = Object.fromEntries(CONDITIONS.map((id) => [id, replayRun(runs[id], createFilter)]));
  const jitter = (id, masks) => {
    const j = renderedJitter(replays[id].renders, masks.poseTimes, outsideBlinks(masks.count, masks.blinks));
    return { positionPx: j.centerPx.rmsHighPass, rotationDeg: j.rotationDeg.rmsHighPass };
  };
  const blinkFrames = replays['rec-blink'].frames;
  const shifts = blinkShift(blinkFrames.map((f) => f.centerPx[1]), prepared.recBlink.blinks);
  const motion = (id) => {
    const { condition, frames, fps } = prepared.motion[id];
    const truthOf = (index) => motionTruth(condition.motion, index);
    const read = condition.motion.axis === 'roll' ? (e) => lineAngle(e.endsPx[0], e.endsPx[1]) : (e) => e.centerPx[0];
    return motionMetrics(renderedSamples(asRenderEvents(replays[id].renders), frames, truthOf, read), frames, condition, fps, truthOf);
  };
  const step = motion('step-x');
  const ramp = motion('ramp-x');
  const sine = motion('sine-roll');
  return {
    still: jitter('still', prepared.still),
    recStatic: jitter('rec-static', prepared.recStatic),
    blinkShiftPx: shifts.length ? median(shifts) : null,
    stepLagMs: step.stepLagMs.median,
    stepLagMaxMs: step.stepLagMs.max,
    stepOvershootPercent: step.overshootPercent.median,
    stepErrorRmsPx: step.error.rms,
    rampDelayMs: ramp.delayMs,
    rampLagMs: ramp.constantVelocityLagMs,
    rampErrorRmsPx: ramp.error.rms,
    sineDelayMs: sine.delayMs,
    sineErrorRmsDeg: sine.error.rms,
  };
};

// Least jitter among points with a lag under the target, else the least lag.
export const operatingPoint = (points, jitterOf, lagOf, lagTarget) => {
  const timed = points.filter((p) => lagOf(p) != null);
  const fast = timed.filter((p) => lagOf(p) < lagTarget);
  if (fast.length) return fast.reduce((best, p) => (jitterOf(p) < jitterOf(best) ? p : best));
  return timed.reduce((best, p) => (lagOf(p) < lagOf(best) ? p : best));
};

// Points not beaten on both lag and jitter by another, by increasing lag.
export const paretoFront = (points, lagOf, jitterOf) => {
  const sorted = points.filter((p) => lagOf(p) != null).sort((a, b) => lagOf(a) - lagOf(b) || jitterOf(a) - jitterOf(b));
  const front = [];
  for (const p of sorted) if (!front.length || jitterOf(p) < jitterOf(front.at(-1))) front.push(p);
  return front;
};

export const rotationJitterOf = (p) => p.metrics.recStatic.rotationDeg;
export const positionJitterOf = (p) => p.metrics.recStatic.positionPx;
export const rotationLagOf = (p) => p.metrics.sineDelayMs;
export const positionLagOf = (p) => (p.metrics.stepLagMs == null || p.metrics.rampDelayMs == null ? null : Math.max(p.metrics.stepLagMs, p.metrics.rampDelayMs));

// A stage's sweep as kept in results.json: its Pareto front, its operating
// point and how many points were tried.
const stage = (points, jitterOf, lagOf) => {
  const chosen = operatingPoint(points, jitterOf, lagOf, TARGETS.lagMs);
  return { evaluated: points.length, front: paretoFront(points, lagOf, jitterOf), chosen };
};

const sweepOneEuro = (runs, prepared) => {
  const grid = (betas) => ONE_EURO_GRID.minCutoffHz.flatMap((minCutoffHz) => betas.flatMap((beta) =>
    ONE_EURO_GRID.derivativeCutoffHz.map((derivativeCutoffHz) => ({ minCutoffHz, beta, derivativeCutoffHz }))));
  const middle = { minCutoffHz: 1, beta: 0.01, derivativeCutoffHz: 1 };
  const rotation = stage(grid(ONE_EURO_GRID.rotationBeta).map((channel) => {
    const params = { rotation: channel, translation: middle };
    return { params, metrics: evaluate(runs, prepared, () => oneEuroPose(params)) };
  }), rotationJitterOf, rotationLagOf);
  const translation = stage(grid(ONE_EURO_GRID.translationBeta).map((channel) => {
    const params = { rotation: rotation.chosen.params.rotation, translation: channel };
    return { params, metrics: evaluate(runs, prepared, () => oneEuroPose(params)) };
  }), positionJitterOf, positionLagOf);
  return { rotation, translation, chosen: translation.chosen };
};

const sweepKalman = (runs, prepared, noise) => {
  const base = { rotationNoiseRad: noise.rotationRad, translationNoiseMm: noise.translationMm };
  const rotation = stage(KALMAN_GRID.angularAccelerationNoise.map((angularAccelerationNoise) => {
    const params = { ...base, angularAccelerationNoise, linearAccelerationNoiseMm: 100 };
    return { params, metrics: evaluate(runs, prepared, () => poseKalman(params)) };
  }), rotationJitterOf, rotationLagOf);
  const translation = stage(KALMAN_GRID.linearAccelerationNoiseMm.map((linearAccelerationNoiseMm) => {
    const params = { ...base, angularAccelerationNoise: rotation.chosen.params.angularAccelerationNoise, linearAccelerationNoiseMm };
    return { params, metrics: evaluate(runs, prepared, () => poseKalman(params)) };
  }), positionJitterOf, positionLagOf);
  return { rotation, translation, chosen: translation.chosen };
};

// The recommended filter and configuration: among the operating points whose
// position and rotation lags are both under the target, the one with the
// smallest worst ratio of position and rotation jitter to their targets.
export const recommend = (configurations) => {
  const candidates = configurations.flatMap((c) => ['oneEuro', 'kalman'].map((filter) => ({ filter, numFaces: c.numFaces, point: c[filter].chosen })));
  const ratio = ({ point }) => Math.max(positionJitterOf(point) / TARGETS.positionJitterPx, rotationJitterOf(point) / TARGETS.rotationJitterDeg);
  const fast = candidates.filter(({ point }) => positionLagOf(point) < TARGETS.lagMs && rotationLagOf(point) < TARGETS.lagMs);
  const best = (fast.length ? fast : candidates).reduce((a, b) => (ratio(b) < ratio(a) ? b : a));
  return { filter: best.filter, numFaces: best.numFaces, worstJitterRatio: ratio(best), lagsUnderTarget: fast.length > 0 };
};

// The unfiltered replay must draw what the run drew; otherwise the replay
// does not model the app and the sweep means nothing.
const replayCheck = (runs) => {
  let worst = 0;
  for (const id of CONDITIONS) {
    const run = runs[id];
    const { renders } = replayRun(run, () => null);
    // Without warmup events the replay has no pose for the renders before
    // the first measured pose sample.
    const recorded = run.events.filter((e) => e.stage === 'renderedPose').slice(-renders.length || Infinity);
    const missing = run.events.filter((e) => e.stage === 'renderedPose').length - renders.length;
    if (missing > (run.warmupEvents ? 0 : 3)) throw new Error(`${id}: the replay drew ${missing} renders fewer than the run`);
    const [vw, vh] = run.environment.viewport;
    renders.forEach((r, i) => {
      const [x, y] = recorded[i].centerNdc;
      worst = Math.max(worst, Math.hypot(r.centerPx[0] - ((x + 1) / 2) * vw, r.centerPx[1] - ((1 - y) / 2) * vh));
    });
  }
  if (worst > 1e-3) throw new Error(`unfiltered replay is ${worst} px off the recorded renders`);
  return worst;
};

const main = () => {
  const labels = (arg('runs') ?? '').split(',').filter(Boolean);
  if (!labels.length) throw new Error('pass --runs <label>[,<label>]');
  const allowDirty = process.argv.includes('--allow-dirty');
  const dirty = git('status', '--porcelain').split('\n').filter((line) => line && !line.endsWith('eval/results.json'));
  if (dirty.length && !allowDirty) {
    console.error(`working tree is dirty; commit first or pass --allow-dirty\n${dirty.join('\n')}`);
    process.exit(1);
  }
  const results = JSON.parse(readFileSync(RESULTS, 'utf8'));
  const configurations = labels.map((label) => {
    const dirtyResults = join(EVAL, '.cache', 'results-dirty.json');
    const recorded = results.runs[label] ?? (allowDirty && existsSync(dirtyResults) ? JSON.parse(readFileSync(dirtyResults, 'utf8')).runs[label] : undefined);
    if (!recorded) throw new Error(`no runs["${label}"] in results.json`);
    if (recorded.dirty && !allowDirty) throw new Error(`runs["${label}"] was measured on a dirty tree`);
    const runs = loadRuns(label);
    const prepared = prepare(runs);
    const noise = solvedPoseNoise(runs['rec-static']);
    const replayErrorPx = replayCheck(runs);
    const numFaces = Number(/numFaces (\d+)/.exec(recorded.pipeline)[1]);
    process.stdout.write(`${label}: one-euro `);
    const oneEuro = sweepOneEuro(runs, prepared);
    process.stdout.write('kalman ');
    const kalman = sweepKalman(runs, prepared, noise);
    console.log('done');
    return {
      label,
      numFaces,
      commit: recorded.commit,
      measuredAt: recorded.measuredAt,
      hardware: { cpu: recorded.hardware.cpu, browser: recorded.hardware.browser, perceptionDelegate: recorded.hardware.perceptionDelegate },
      replayErrorPx,
      solvedPoseNoise: noise,
      unfiltered: evaluate(runs, prepared, () => null),
      oneEuro,
      kalman,
    };
  });
  const entry = round({
    measuredAt: new Date().toISOString(),
    commit: git('rev-parse', 'HEAD'),
    dirty: dirty.length > 0,
    command: `node eval/harness/poseFilterSweep.mjs ${process.argv.slice(2).join(' ')}`.trim(),
    method: 'Offline replay of runs recorded with the filter off: each shown pose sample updates the filter at its frame capture time, a lost face resets it, and each render predicts to the newest presented frame (eval/harness/poseReplay.mjs). Jitter is the RMS high-pass of what renders drew on rec-static (blinks masked); lags are on the motion clips against the frame on screen.',
    targets: TARGETS,
    lags: 'position lag: the larger of the median lag to 90% on step-x and the delay on ramp-x; rotation lag: the delay on sine-roll',
    selection: 'Rotation, then translation with the chosen rotation: the least rec-static jitter among points with a lag under the target, else the least lag. The recommendation is the operating point with both lags under the target and the smallest worst ratio of position and rotation jitter to their targets.',
    grids: { oneEuro: { ...ONE_EURO_GRID, translationDuringRotationSweep: { minCutoffHz: 1, beta: 0.01, derivativeCutoffHz: 1 } }, kalman: { ...KALMAN_GRID, linearAccelerationNoiseMmDuringRotationSweep: 100 } },
    recommended: recommend(configurations),
    configurations,
  });
  const out = dirty.length ? join(EVAL, '.cache', 'results-dirty.json') : RESULTS;
  const target = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { runs: {} };
  target.runs[SWEEP_KEY] = entry;
  writeFileSync(out, `${JSON.stringify(target, null, 2)}\n`);
  console.log(`wrote ${out}`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
