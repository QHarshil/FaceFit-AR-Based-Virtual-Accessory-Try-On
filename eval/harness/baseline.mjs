#!/usr/bin/env node
// Measures the try-on pipeline on replayed clips and writes eval/results.json.
//
//   node eval/harness/baseline.mjs --source recordings
//   node eval/harness/baseline.mjs --source recordings --allow-dirty   (writes to eval/.cache only)
//   node eval/harness/baseline.mjs --source recordings --clips <dir> --label <name>
//   node eval/harness/baseline.mjs --source recordings --num-faces 2 --label <name>
//   node eval/harness/baseline.mjs --source recordings --pose-filter off --label <name>
//
// --clips reads the Y4M clips from another checkout. --label is the key under
// `runs` in results.json (default: baseline-<source>) and names the folder of
// raw runs in eval/.cache/runs. --num-faces sets VITE_NUM_FACES for the build
// (default 1, the app's default). --pose-filter sets VITE_POSE_FILTER (off,
// one-euro or kalman; default: the app's).
//
// Builds the production bundle, serves it with `vite preview` (which sends the
// production CSP) and the catalog API on a fresh PGlite database seeded from
// assets/catalog.json, replays each clip in Chrome as the fake camera, and
// summarizes the probe events. Then checks the worker's guard with
// off-origin requests issued inside the worker (selfTestWorkerGuard) and the
// CPU fallback with the first delegate forced to fail. Fails without writing
// results if any request left localhost, the CSP blocked anything on the page,
// the guard missed a self-test request, or the fallback did not reach the CPU.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONDITIONS, FRAME, FRAME_CODE, MOTION, PRODUCT_ZOOMS, PRODUCTS, RECORDED, motionPeriodFrames, motionTruth } from './conditions.mjs';
import { blinkShift, findBlinks, latency, linearFit, maxChangeFromStillPercent, median, ndcToPx, outsideBlinks, pointJitter, renderedJitter, rotationJitter, sampleGeometry, shownPoses, solverSummary, windowSamples, wrapLineAngle } from './metrics.mjs';
import { frameSamples, mediaTimeMismatchShare, motionMetrics, presentationRate, presentedFrames, readCenterX, readLineAngle, renderedSamples } from './motionMetrics.mjs';
import { offDeviceRequests, sawWorkerFetch } from './network.mjs';
import { assertHeadUnchanged, dirtyPaths, gitIn, startCommit } from './provenance.mjs';
import { runCondition, selfTestWorkerGuard } from './run.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(EVAL, '..');
const API_PORT = 5077;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_PORT = 4177;
const RESULTS = join(EVAL, 'results.json');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const source = arg('source', 'recordings');
const label = arg('label', `baseline-${source}`);
const allowDirty = process.argv.includes('--allow-dirty');
const numFaces = Number(arg('num-faces', '1'));
if (!Number.isInteger(numFaces) || numFaces < 1) {
  console.error('--num-faces takes a positive integer');
  process.exit(1);
}
const poseFilter = arg('pose-filter');
if (poseFilter !== undefined && !['off', 'one-euro', 'kalman'].includes(poseFilter)) {
  console.error('--pose-filter takes off, one-euro or kalman');
  process.exit(1);
}
// The clip directory is machine-specific, so the recorded command omits its value.
const commandArgs = process.argv.slice(2).map((a, i, all) => (all[i - 1] === '--clips' ? '<dir>' : a));
const git = gitIn(REPO);

const dirty = dirtyPaths(git);
if (dirty.length && !allowDirty) {
  console.error(`working tree is dirty; commit first or pass --allow-dirty\n${dirty.join('\n')}`);
  process.exit(1);
}
// The build below is from this commit, whatever HEAD is when the run ends.
const commit = startCommit(git);

const clipDir = arg('clips') ? resolve(arg('clips')) : join(EVAL, '.cache', 'clips', source);
const runDir = join(EVAL, '.cache', 'runs', label);
const screenDir = join(EVAL, '.cache', 'screens', source);
for (const dir of [runDir, screenDir]) mkdirSync(dir, { recursive: true });

const FRONTEND = join(REPO, 'frontend');
console.log('building frontend');
const buildEnv = { ...process.env, VITE_API_URL: API_URL, VITE_NUM_FACES: String(numFaces) };
if (poseFilter) buildEnv.VITE_POSE_FILTER = poseFilter;
else delete buildEnv.VITE_POSE_FILTER;
execFileSync('npm', ['run', 'build'], { cwd: FRONTEND, env: buildEnv, stdio: 'ignore' });

const startPreview = async () => {
  const preview = spawn(process.execPath, [join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: FRONTEND,
    env: { ...process.env, VITE_API_URL: API_URL },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`http://localhost:${WEB_PORT}/`)).ok) return preview;
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  preview.kill();
  throw new Error('vite preview did not start');
};

// The catalog API on its own PGlite database, which allows the preview origin
// and lifts the rate limits that a run of many page loads would hit.
const BACKEND = join(REPO, 'backend');
const apiDatabase = join(EVAL, '.cache', 'api-db');
const apiEnv = {
  ...process.env,
  PORT: String(API_PORT),
  DATABASE_URL: `pglite://${apiDatabase}`,
  CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
  RATE_LIMIT_MAX: '1000000',
  TELEMETRY_RATE_LIMIT_MAX: '1000000',
};
console.log('building backend');
execFileSync('npm', ['run', 'build'], { cwd: BACKEND, stdio: 'ignore' });
rmSync(apiDatabase, { recursive: true, force: true });
for (const step of ['migrate', 'seed']) {
  execFileSync(process.execPath, [join('dist', 'cli', `${step}.js`)], { cwd: BACKEND, env: apiEnv, stdio: 'ignore' });
}

const waitFor = async (url, what) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`${what} did not start`);
};

const api = spawn(process.execPath, [join('dist', 'server.js')], { cwd: BACKEND, env: apiEnv, stdio: 'ignore' });
let web;
try {
  await waitFor(`${API_URL}/api/ready`, 'catalog API');
  web = await startPreview();
} catch (error) {
  api.kill();
  throw error;
}

const clipOf = (c) => join(clipDir, `${c.clip || c.id}.y4m`);
const conditions = [...CONDITIONS, ...PRODUCTS, ...PRODUCT_ZOOMS, ...RECORDED, ...MOTION].filter((c) => existsSync(clipOf(c)));
const runs = {};
let environment;
let guardSelfTest;
let cpuFallback;
try {
  for (const condition of conditions) {
    process.stdout.write(`${condition.id} `);
    const run = await runCondition({
      clip: clipOf(condition),
      url: `http://localhost:${WEB_PORT}/try-on/${condition.productId}`,
      warmupSeconds: condition.warmupSeconds,
      measureSeconds: condition.measureSeconds,
      screenshot: join(screenDir, `${condition.id}.png`),
      frameCode: condition.motion ? FRAME_CODE : null,
    });
    writeFileSync(join(runDir, `${condition.id}.json`), JSON.stringify(run));
    environment = run.environment;
    runs[condition.id] = run;
  }
  const still = conditions.find((c) => c.id === 'still');
  if (still) {
    const url = `http://localhost:${WEB_PORT}/try-on/${still.productId}`;
    process.stdout.write('guard-self-test ');
    guardSelfTest = await selfTestWorkerGuard({ clip: clipOf(still), url });
    process.stdout.write('cpu-fallback ');
    cpuFallback = await runCondition({ clip: clipOf(still), url, warmupSeconds: still.warmupSeconds, measureSeconds: still.measureSeconds, failFirstAttempt: true });
    writeFileSync(join(runDir, 'cpu-fallback.json'), JSON.stringify(cpuFallback));
  }
} finally {
  api.kill();
  web.kill();
}
console.log();

const checkedRuns = cpuFallback ? { ...runs, 'cpu-fallback': cpuFallback } : runs;
const network = Object.fromEntries(Object.entries(checkedRuns).map(([id, run]) => [id, {
  requests: run.requests.length,
  offDevice: offDeviceRequests(run.requests),
  workerFetchSeen: sawWorkerFetch(run.requests),
  cspViolations: run.cspViolations,
  blocked: run.blocked,
}]));
const networkProblems = Object.entries(network).flatMap(([id, n]) => [
  ...n.offDevice.map((url) => `${id}: request left localhost: ${url}`),
  ...n.cspViolations.map((violation) => `${id}: CSP violation: ${violation}`),
  ...(n.workerFetchSeen ? [] : [`${id}: the worker's model request was not captured`]),
]);
if (guardSelfTest) {
  for (const [api, probe] of Object.entries(guardSelfTest.probes)) {
    if (probe.outcome === 'missed') networkProblems.push(`guard self-test: ${api} to ${probe.url} was neither blocked nor recorded`);
  }
} else {
  networkProblems.push('guard self-test did not run: the still clip is missing');
}
if (cpuFallback?.delegate !== 'CPU') networkProblems.push(`cpu fallback: expected the CPU delegate, got ${cpuFallback?.delegate ?? 'no run'}`);
if (networkProblems.length) {
  console.error(`checks failed; results not written\n${networkProblems.join('\n')}`);
  process.exit(1);
}
const blockedAttempts = Object.values(network).flatMap((n) => n.blocked);

const geometryOf = (run) => shownPoses(run.events).map((e) => sampleGeometry(e, run.environment.video, run.environment.viewport));

const round = (value, digits = 2) => (value == null ? null : Number(value.toFixed(digits)));
const roundAll = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'number' ? round(v, 3) : v)));

// Jitter with blinks and their neighbours masked out. The high-pass window
// spans about 150 ms whatever the pose rate.
const jitterOf = (allGeometry, run) => {
  const allPoses = shownPoses(run.events);
  const blinks = findBlinks(allGeometry.map((g) => g.eyeOpenness));
  const keep = outsideBlinks(allGeometry.length, blinks);
  const geometry = keep.map((i) => allGeometry[i]);
  const poses = keep.map((i) => allPoses[i]);
  const iod = median(geometry.map((g) => g.interocular));
  const window = windowSamples(allPoses.map((e) => e.t));
  return {
    samples: geometry.length,
    blinksMasked: blinks.length,
    windowSamples: window,
    interocularPx: iod,
    landmarkNoseBridgePx: pointJitter(geometry.map((g) => g.noseBridge), window),
    rawCenterPx: pointJitter(geometry.map((g) => g.targetCenter), window),
    smoothedCenterPx: pointJitter(geometry.map((g) => g.renderedCenter), window),
    rawRotationDeg: rotationJitter(poses.map((e) => e.targetQuat), window),
    smoothedRotationDeg: rotationJitter(poses.map((e) => e.smoothedQuat), window),
    rendered: renderedJitterOf(allPoses, blinks, run),
  };
};

// Jitter of what each render drew, with the same blink mask in time.
const renderedJitterOf = (allPoses, blinks, run) => renderedJitter(
  run.events.filter((e) => e.stage === 'renderedPose').map((e) => ({ t: e.t, centerPx: ndcToPx(e.centerNdc, run.environment.viewport), quat: e.quat })),
  allPoses.map((e) => e.t),
  outsideBlinks(allPoses.length, blinks),
);

const summary = { latency: {}, jitter: {}, solver: {}, roll: null, registration: null, scale: null, scaleByProduct: null, products: null, blink: null, motion: null };
const geometry = Object.fromEntries(Object.entries(runs).map(([id, run]) => [id, geometryOf(run)]));
const medianOf = (id, key) => median(geometry[id].map((g) => g[key]));

const solver = Object.fromEntries(Object.entries(runs).map(([id, run]) => [id, solverSummary(run.events)]));
// The motion clips are kept out of the overall share so it stays comparable
// with runs before them; their own shares are under byCondition.
const stillSolver = Object.entries(solver).filter(([id]) => !MOTION.some((m) => m.id === id)).map(([, s]) => s);
const allSamples = stillSolver.reduce((sum, s) => sum + s.samples, 0);
summary.solver = {
  gatedShare: allSamples ? stillSolver.reduce((sum, s) => sum + s.gated, 0) / allSamples : null,
  byCondition: solver,
};

for (const id of ['still', 'rec-static']) {
  if (!runs[id]) continue;
  summary.latency[id] = latency(runs[id].events, conditions.find((c) => c.id === id).measureSeconds);
  summary.jitter[id] = jitterOf(geometry[id], runs[id]);
}

const rollIds = ['still', ...CONDITIONS.filter((c) => c.group === 'roll').map((c) => c.id)].filter((id) => runs[id]);
if (rollIds.length > 2) {
  const face = rollIds.map((id) => medianOf(id, 'faceAngle'));
  const rendered = rollIds.map((id, i) => face[i] + wrapLineAngle(medianOf(id, 'renderedAngle') - face[i]));
  const eulerAxis = (axis) => rollIds.map((id) => median(geometry[id].map((g) => g.euler[axis])));
  summary.roll = {
    conditions: rollIds,
    faceAngleDeg: face,
    renderedAngleDeg: rendered,
    renderedPerFaceDeg: linearFit(face, rendered).slope,
    // XYZ Euler angles of the rendered pose, decomposed for reporting only.
    // Roll is about the viewer-facing axis, so it runs opposite to the
    // clockwise screen angle.
    eulerPitchPerFaceRollDeg: linearFit(face, eulerAxis(0)).slope,
    eulerYawPerFaceRollDeg: linearFit(face, eulerAxis(1)).slope,
    eulerRollPerFaceRollDeg: linearFit(face, eulerAxis(2)).slope,
  };
}

const axisIds = (axis) => ['still', ...CONDITIONS.filter((c) => c.group === 'translate' && c[axis] !== 0).map((c) => c.id)].filter((id) => runs[id]);
if (runs.still) {
  const gain = (ids, k) => linearFit(
    ids.map((id) => median(geometry[id].map((g) => g.noseBridge[k]))),
    ids.map((id) => median(geometry[id].map((g) => g.renderedCenter[k]))),
  ).slope;
  const offsetAt = (id) => [0, 1].map((k) => median(geometry[id].map((g) => g.renderedCenter[k] - g.noseBridge[k])));
  summary.registration = {
    gainX: gain(axisIds('dx'), 0),
    gainY: gain(axisIds('dy'), 1),
    offsetPxByCondition: Object.fromEntries([...new Set([...axisIds('dx'), ...axisIds('dy')])].map((id) => [id, offsetAt(id)])),
    interocularPx: medianOf('still', 'interocular'),
  };
  const zoomIds = ['still', ...CONDITIONS.filter((c) => c.group === 'zoom').map((c) => c.id)].filter((id) => runs[id]);
  summary.scale = Object.fromEntries(zoomIds.map((id) => [id, {
    faceWidthPx: medianOf(id, 'faceWidth'),
    renderedWidthPx: medianOf(id, 'renderedWidth'),
    renderedOverFace: medianOf(id, 'renderedWidth') / medianOf(id, 'faceWidth'),
  }]));
}

// Rendered width over face width at each zoom, per product.
const ratioAt = (id) => (geometry[id].length ? medianOf(id, 'renderedWidth') / medianOf(id, 'faceWidth') : null);
const zoomIdsOf = (productId) => (productId === 1
  ? { 'zoom0.75': 'zoom0.75', still: 'still', 'zoom1.33': 'zoom1.33' }
  : { 'zoom0.75': `product${productId}-zoom0.75`, still: `product${productId}`, 'zoom1.33': `product${productId}-zoom1.33` });
summary.scaleByProduct = Object.fromEntries([1, 2, 3, 4].map((productId) => {
  const ratios = Object.fromEntries(Object.entries(zoomIdsOf(productId)).filter(([, id]) => runs[id]).map(([zoom, id]) => [zoom, ratioAt(id)]));
  return [`product${productId}`, { renderedOverFace: ratios, maxChangeFromStillPercent: maxChangeFromStillPercent(ratios) }];
}));

const productIds = ['still', ...PRODUCTS.map((c) => c.id)].filter((id) => runs[id]);
if (productIds.length > 1) {
  summary.products = Object.fromEntries(productIds.map((id) => [id === 'still' ? 'product1' : id, {
    renderedOverFace: medianOf(id, 'renderedWidth') / medianOf(id, 'faceWidth'),
    centerMinusNoseBridgePx: [0, 1].map((k) => median(geometry[id].map((s) => s.renderedCenter[k] - s.noseBridge[k]))),
  }]));
}

if (runs['rec-blink']) {
  const g = geometry['rec-blink'];
  const blinks = findBlinks(g.map((s) => s.eyeOpenness));
  const iod = median(g.map((s) => s.interocular));
  const shifts = (key) => blinkShift(g.map((s) => s[key][1]), blinks);
  const raw = shifts('targetCenter');
  const smoothed = shifts('renderedCenter');
  const landmark = shifts('noseBridge');
  const anchorShift = (key) => blinkShift(g.map((s) => s[key]), blinks);
  const heuristic = anchorShift('heuristicAnchorY');
  const corners = anchorShift('cornerAnchorY');
  summary.blink = {
    samples: g.length,
    blinks: blinks.length,
    interocularPx: iod,
    rawCenterShiftPx: { median: median(raw), max: Math.max(...raw) },
    smoothedCenterShiftPx: { median: median(smoothed), max: Math.max(...smoothed) },
    noseBridgeLandmarkShiftPx: { median: median(landmark), max: Math.max(...landmark) },
    heuristicAnchorShiftPx: { median: median(heuristic), max: Math.max(...heuristic) },
    eyeCornerAnchorShiftPx: { median: median(corners), max: Math.max(...corners) },
    smoothedShiftPercentOfInterocular: (100 * median(smoothed)) / iod,
  };
}

// Motion clips: the overlay at each render against the frame on screen, the
// filtered pose of each processed frame and the face's own landmarks against
// that frame's truth.
summary.motion = Object.fromEntries(MOTION.filter((c) => runs[c.id]).map((condition) => {
  const run = runs[condition.id];
  const { viewport, video } = run.environment;
  const truthOf = (index) => motionTruth(condition.motion, index);
  const clipFrames = condition.clipSeconds * FRAME.fps;
  const frames = presentedFrames(run.events, run.frameCodes, clipFrames);
  const fps = presentationRate(frames, clipFrames);
  const roll = condition.motion.axis === 'roll';
  const renderRead = roll ? (e) => readLineAngle(viewport)(e.endsNdc) : (e) => readCenterX(viewport)(e.centerNdc);
  const smoothedRead = roll ? (e) => readLineAngle(viewport)(e.smoothedEndsNdc) : (e) => readCenterX(viewport)(e.smoothedNdc);
  const faceRead = (e) => {
    const g = sampleGeometry(e, video, viewport);
    return roll ? g.faceAngle : g.noseBridge[0];
  };
  const series = (samples) => motionMetrics(samples, frames, condition, fps, truthOf);
  return [condition.id, {
    motion: condition.motion,
    unit: roll ? 'deg' : 'px',
    presentedFrames: frames.length,
    framesPerSecond: fps,
    periodFrames: motionPeriodFrames(condition.motion),
    mediaTimeMismatchShare: mediaTimeMismatchShare(frames, FRAME.fps, clipFrames),
    gatedShare: solver[condition.id].gatedShare,
    rendered: series(renderedSamples(run.events, frames, truthOf, renderRead)),
    smoothed: series(frameSamples(run.events, frames, truthOf, smoothedRead)),
    face: series(frameSamples(run.events, frames, truthOf, faceRead)),
  }];
}));

// The pose settings the app reported with its first pose sample.
const firstPose = Object.values(runs).flatMap((run) => run.events).find((e) => e.stage === 'glassesPose' && e.focalPx != null);
const filterDescription = (setting) => (setting && setting !== 'off' ? `${setting} pose filter, renders predict to the newest presented frame` : 'no temporal filter');
const poseDescription = firstPose
  ? `solveHeadPose on the 33 rigid landmarks, ${(2 * Math.atan(firstPose.frameSize[0] / 2 / firstPose.focalPx) * 180 / Math.PI).toFixed(1)} deg horizontal FOV assumed, overlay hidden above ${firstPose.gateMaxRmsMm} mm reprojection RMS, ${filterDescription(firstPose.poseFilter)}`
  : 'no pose samples';

const tasksVisionVersion = JSON.parse(readFileSync(join(FRONTEND, 'node_modules', '@mediapipe', 'tasks-vision', 'package.json'), 'utf8')).version;
const delegates = [...new Set(Object.values(runs).map((run) => run.delegate))];
const entry = roundAll({
  measuredAt: new Date().toISOString(),
  commit,
  dirty: dirty.length > 0,
  command: `node eval/harness/baseline.mjs ${commandArgs.join(' ')}`.trim(),
  pipeline: `@mediapipe/tasks-vision ${tasksVisionVersion} FaceLandmarker, VIDEO mode, numFaces ${numFaces}, ${delegates.join('/')} delegate, module worker at camera rate, self-hosted; ${poseDescription}`,
  hardware: {
    cpu: cpus()[0].model,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    os: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
    browser: environment.userAgent,
    webglRenderer: environment.webglRenderer,
    viewport: environment.viewport,
    video: environment.video,
    cameraFps: environment.cameraFps,
    perceptionDelegate: delegates.join('/'),
  },
  input: source === 'standin' ? 'still portrait (public domain), synthetic transforms and noise' : 'webcam recordings (eval/fixtures/recordings); sweeps and motion clips from the first frame of static.mp4 with synthetic transforms and noise',
  conditions: Object.fromEntries(conditions.map((c) => [c.id, { group: c.group, measureSeconds: c.measureSeconds, samples: geometry[c.id].length, gated: solver[c.id].gated, pageErrors: runs[c.id].errors.length, requests: network[c.id].requests, blockedOffOriginAttempts: network[c.id].blocked.length }])),
  network: {
    requests: Object.values(network).reduce((sum, n) => sum + n.requests, 0),
    offDeviceRequests: 0,
    cspViolations: 0,
    blockedOffOriginAttempts: blockedAttempts.length,
    blockedOffOriginUrls: [...new Set(blockedAttempts)],
    check: 'every request from the page and its worker, in the measured conditions and the CPU fallback run, went to localhost (eval/harness/network.mjs)',
    workerGuardSelfTest: {
      fetch: guardSelfTest.probes.fetch.outcome,
      xhr: guardSelfTest.probes.xhr.outcome,
      usageLogBlockedAfterSeconds: guardSelfTest.usageLogBlockedAfterSeconds,
      blocked: guardSelfTest.blocked,
      offDeviceRequests: guardSelfTest.offDevice,
    },
  },
  cpuFallback: {
    condition: 'still',
    forcedFailure: 'first delegate (GPU) failed by the harness after its loader ran (eval/harness/run.mjs failFirstDelegate)',
    delegate: cpuFallback.delegate,
    latency: latency(cpuFallback.events, conditions.find((c) => c.id === 'still').measureSeconds),
  },
  summary,
});

try {
  assertHeadUnchanged(git, commit);
} catch (error) {
  console.error(`${error.message}; results not written`);
  process.exit(1);
}
const out = allowDirty && dirty.length ? join(EVAL, '.cache', 'results-dirty.json') : RESULTS;
const results = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { runs: {} };
results.runs[label] = entry;
writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
console.log(`wrote ${out}`);
