#!/usr/bin/env node
// Measures the try-on pipeline on replayed clips and writes eval/results.json.
//
//   node eval/harness/baseline.mjs --source recordings
//   node eval/harness/baseline.mjs --source recordings --allow-dirty   (writes to eval/.cache only)
//   node eval/harness/baseline.mjs --source recordings --clips <dir> --label <name>
//
// --clips reads the Y4M clips from another checkout. --label is the key under
// `runs` in results.json (default: baseline-<source>).
//
// Builds the production bundle, serves it with the catalog API, replays each
// clip in Chrome as the fake camera, and summarizes the probe events.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONDITIONS, PRODUCTS, RECORDED } from './conditions.mjs';
import { blinkShift, findBlinks, latency, linearFit, median, outsideBlinks, pointJitter, rotationJitter, sampleGeometry, wrapLineAngle } from './metrics.mjs';
import { runCondition } from './run.mjs';
import { serveBuild } from './serve.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(EVAL, '..');
const API_PORT = 5077;
const WEB_PORT = 4177;
const RESULTS = join(EVAL, 'results.json');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const source = arg('source', 'recordings');
const label = arg('label', `baseline-${source}`);
const allowDirty = process.argv.includes('--allow-dirty');
// The clip directory is machine-specific, so the recorded command omits its value.
const commandArgs = process.argv.slice(2).map((a, i, all) => (all[i - 1] === '--clips' ? '<dir>' : a));
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();

const dirty = git('status', '--porcelain').split('\n').filter((line) => line && !line.endsWith('eval/results.json'));
if (dirty.length && !allowDirty) {
  console.error(`working tree is dirty; commit first or pass --allow-dirty\n${dirty.join('\n')}`);
  process.exit(1);
}

const clipDir = arg('clips') ? resolve(arg('clips')) : join(EVAL, '.cache', 'clips', source);
const runDir = join(EVAL, '.cache', 'runs', source);
const screenDir = join(EVAL, '.cache', 'screens', source);
for (const dir of [runDir, screenDir]) mkdirSync(dir, { recursive: true });

console.log('building frontend');
execFileSync('npm', ['run', 'build'], {
  cwd: join(REPO, 'frontend'),
  env: { ...process.env, VITE_API_URL: `http://localhost:${API_PORT}` },
  stdio: 'ignore',
});
const api = spawn('node', ['server.js'], { cwd: join(REPO, 'backend'), env: { ...process.env, PORT: String(API_PORT) }, stdio: 'ignore' });
const web = await serveBuild(join(REPO, 'frontend', 'dist'), WEB_PORT);

const clipOf = (c) => join(clipDir, `${c.clip || c.id}.y4m`);
const conditions = [...CONDITIONS, ...PRODUCTS, ...RECORDED].filter((c) => existsSync(clipOf(c)));
const runs = {};
let environment;
try {
  for (const condition of conditions) {
    process.stdout.write(`${condition.id} `);
    const run = await runCondition({
      clip: clipOf(condition),
      url: `http://localhost:${WEB_PORT}/try-on/${condition.productId}`,
      warmupSeconds: condition.warmupSeconds,
      measureSeconds: condition.measureSeconds,
      screenshot: join(screenDir, `${condition.id}.png`),
    });
    writeFileSync(join(runDir, `${condition.id}.json`), JSON.stringify(run));
    environment = run.environment;
    runs[condition.id] = run;
  }
} finally {
  api.kill();
  web.close();
}
console.log();

const geometryOf = (run) => run.events
  .filter((e) => e.stage === 'glassesPose')
  .map((e) => sampleGeometry(e, run.environment.video, run.environment.viewport));

const round = (value, digits = 2) => (value == null ? null : Number(value.toFixed(digits)));
const roundAll = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'number' ? round(v, 3) : v)));

// Jitter with blinks and their neighbours masked out.
const jitterOf = (allGeometry, run) => {
  const allPoses = run.events.filter((e) => e.stage === 'glassesPose');
  const blinks = findBlinks(allGeometry.map((g) => g.eyeOpenness));
  const keep = outsideBlinks(allGeometry.length, blinks);
  const geometry = keep.map((i) => allGeometry[i]);
  const poses = keep.map((i) => allPoses[i]);
  const iod = median(geometry.map((g) => g.interocular));
  return {
    samples: geometry.length,
    blinksMasked: blinks.length,
    interocularPx: iod,
    landmarkNoseBridgePx: pointJitter(geometry.map((g) => g.noseBridge)),
    rawCenterPx: pointJitter(geometry.map((g) => g.targetCenter)),
    smoothedCenterPx: pointJitter(geometry.map((g) => g.renderedCenter)),
    rawRotationDeg: rotationJitter(poses.map((e) => e.targetQuat)),
    smoothedRotationDeg: rotationJitter(poses.map((e) => e.smoothedQuat)),
  };
};

const summary = { latency: {}, jitter: {}, roll: null, registration: null, scale: null, products: null, blink: null };
const geometry = Object.fromEntries(Object.entries(runs).map(([id, run]) => [id, geometryOf(run)]));
const medianOf = (id, key) => median(geometry[id].map((g) => g[key]));

for (const id of ['still', 'rec-static']) {
  if (!runs[id]) continue;
  summary.latency[id] = latency(runs[id].events);
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
    heuristicPitchPerFaceRollDeg: linearFit(face, eulerAxis(0)).slope,
    heuristicYawPerFaceRollDeg: linearFit(face, eulerAxis(1)).slope,
    heuristicRollPerFaceRollDeg: linearFit(face, eulerAxis(2)).slope,
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
  const current = anchorShift('currentAnchorY');
  const corners = anchorShift('cornerAnchorY');
  summary.blink = {
    samples: g.length,
    blinks: blinks.length,
    interocularPx: iod,
    rawCenterShiftPx: { median: median(raw), max: Math.max(...raw) },
    smoothedCenterShiftPx: { median: median(smoothed), max: Math.max(...smoothed) },
    noseBridgeLandmarkShiftPx: { median: median(landmark), max: Math.max(...landmark) },
    currentAnchorShiftPx: { median: median(current), max: Math.max(...current) },
    eyeCornerAnchorShiftPx: { median: median(corners), max: Math.max(...corners) },
    smoothedShiftPercentOfInterocular: (100 * median(smoothed)) / iod,
  };
}

const facemeshVersion = JSON.parse(readFileSync(join(REPO, 'frontend', 'node_modules', '@mediapipe', 'face_mesh', 'package.json'), 'utf8')).version;
const entry = roundAll({
  measuredAt: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'),
  dirty: dirty.length > 0,
  command: `node eval/harness/baseline.mjs ${commandArgs.join(' ')}`.trim(),
  pipeline: `@mediapipe/face_mesh ${facemeshVersion} (WASM and model from unpinned jsdelivr), heuristic Euler pose, lerp/slerp alpha 0.3`,
  hardware: {
    cpu: cpus()[0].model,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    os: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
    browser: environment.userAgent,
    webglRenderer: environment.webglRenderer,
    viewport: environment.viewport,
    video: environment.video,
    cameraFps: environment.cameraFps,
  },
  input: source === 'standin' ? 'still portrait (public domain), synthetic transforms and noise' : 'webcam recordings (eval/fixtures/recordings); sweeps from the first frame of static.mp4 with synthetic transforms and noise',
  conditions: Object.fromEntries(conditions.map((c) => [c.id, { group: c.group, measureSeconds: c.measureSeconds, samples: geometry[c.id].length, pageErrors: runs[c.id].errors.length }])),
  summary,
});

const out = allowDirty && dirty.length ? join(EVAL, '.cache', 'results-dirty.json') : RESULTS;
const results = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { runs: {} };
results.runs[label] = entry;
writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
console.log(`wrote ${out}`);
