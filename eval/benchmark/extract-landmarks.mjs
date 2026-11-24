#!/usr/bin/env node
// Runs MediaPipe FaceLandmarker on every AFLW2000-3D image in headless Chrome
// and caches the landmarks and facial transformation matrices in
// eval/.cache/landmarks/. Same package, model and browser engine as the app;
// IMAGE mode, so no temporal smoothing touches a sample.
//
//   node eval/datasets/download-aflw2000.mjs && node eval/benchmark/extract-landmarks.mjs
//
// The page is served from 127.0.0.1 and every other request is aborted, so
// images and landmarks stay on this machine. tasks-vision posts usage logs to
// a Google endpoint; those attempts are counted and blocked.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { AFLW2000_DIR, AFLW2000_SAMPLES, aflw2000Samples } from '../datasets/download-aflw2000.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const TASKS_VISION_DIR = join(EVAL, 'node_modules', '@mediapipe', 'tasks-vision');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
export const MODEL_SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
export const TASKS_VISION_VERSION = '1.2.3';
const MODEL_PATH = join(EVAL, '.cache', 'models', 'face_landmarker.task');
export const LANDMARK_CACHE = join(EVAL, '.cache', 'landmarks', 'aflw2000-face-landmarker.json');
export const LANDMARKER_OPTIONS = {
  runningMode: 'IMAGE',
  numFaces: 1,
  minFaceDetectionConfidence: 0.5,
  minFacePresenceConfidence: 0.5,
  outputFaceBlendshapes: false,
  outputFacialTransformationMatrixes: true,
};
// XNNPACK on the CPU gives the same output on every machine; the app's GPU
// path can differ in the last bits of float16 arithmetic.
export const DELEGATE = 'CPU';
const BATCH = 25;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function ensureModel() {
  if (!existsSync(MODEL_PATH)) {
    mkdirSync(dirname(MODEL_PATH), { recursive: true });
    const response = await fetch(MODEL_URL, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`model download: HTTP ${response.status}`);
    writeFileSync(MODEL_PATH, Buffer.from(await response.arrayBuffer()));
  }
  const digest = sha256(readFileSync(MODEL_PATH));
  if (digest !== MODEL_SHA256) throw new Error(`${MODEL_PATH} has SHA-256 ${digest}, expected ${MODEL_SHA256}; delete it to refetch`);
}

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { FaceLandmarker, FilesetResolver } from '/tasks-vision/vision_bundle.mjs';
const options = ${JSON.stringify(LANDMARKER_OPTIONS)};
const fileset = await FilesetResolver.forVisionTasks('/tasks-vision/wasm');
const landmarker = await FaceLandmarker.createFromOptions(fileset, {
  ...options,
  baseOptions: { modelAssetPath: '/model/face_landmarker.task', delegate: '${DELEGATE}' },
});
const round = (v) => Number(v.toPrecision(8));
window.detectFaces = async (names) => {
  const detections = {};
  for (const name of names) {
    const image = new Image();
    image.src = '/images/' + name + '.jpg';
    await image.decode();
    const result = landmarker.detect(image);
    const face = result.faceLandmarks[0];
    const matrix = result.facialTransformationMatrixes?.[0];
    detections[name] = {
      width: image.naturalWidth,
      height: image.naturalHeight,
      landmarks: face ? face.map((p) => [round(p.x), round(p.y), round(p.z)]) : null,
      matrix: matrix ? { rows: matrix.rows, columns: matrix.columns, data: Array.from(matrix.data) } : null,
    };
  }
  return detections;
};
window.landmarkerReady = true;
</script>`;

const ROUTES = [
  [/^\/tasks-vision\/(vision_bundle\.mjs)$/, (m) => join(TASKS_VISION_DIR, m[1])],
  [/^\/tasks-vision\/wasm\/(vision_wasm_[a-z_]+\.(?:js|wasm))$/, (m) => join(TASKS_VISION_DIR, 'wasm', m[1])],
  [/^\/model\/face_landmarker\.task$/, () => MODEL_PATH],
  [/^\/images\/(image\d{5}\.jpg)$/, (m) => join(AFLW2000_DIR, m[1])],
];
const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.task': 'application/octet-stream' };

/** Serves only the page, the pinned package files, the model and dataset images, on loopback. */
function serve() {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE);
      return;
    }
    for (const [pattern, fileFor] of ROUTES) {
      const match = path.match(pattern);
      if (match && existsSync(fileFor(match))) {
        res.writeHead(200, { 'Content-Type': TYPES[path.slice(path.lastIndexOf('.'))] });
        createReadStream(fileFor(match)).pipe(res);
        return;
      }
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const dirty = execFileSync('git', ['-C', EVAL, 'status', '--porcelain'], { encoding: 'utf8' })
    .split('\n')
    .some((line) => line && !line.endsWith('eval/results.json'));
  const names = aflw2000Samples();
  if (names.length !== AFLW2000_SAMPLES) throw new Error(`found ${names.length} AFLW2000 samples; run eval/datasets/download-aflw2000.mjs`);
  const installed = JSON.parse(readFileSync(join(TASKS_VISION_DIR, 'package.json'), 'utf8')).version;
  if (installed !== TASKS_VISION_VERSION) throw new Error(`@mediapipe/tasks-vision ${installed} installed, expected ${TASKS_VISION_VERSION}; run npm ci in eval/`);
  await ensureModel();

  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    // A second guard under request routing: nothing but loopback resolves.
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
  });
  const blockedRequests = [];
  const pageErrors = [];
  const detections = {};
  let userAgent;
  const started = performance.now();
  try {
    const context = await browser.newContext();
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(`${origin}/`)) return route.continue();
      blockedRequests.push(new URL(url).host);
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => window.landmarkerReady === true, null, { timeout: 120_000 });
    userAgent = await page.evaluate(() => navigator.userAgent);
    for (let i = 0; i < names.length; i += BATCH) {
      Object.assign(detections, await page.evaluate((batch) => window.detectFaces(batch), names.slice(i, i + BATCH)));
      process.stdout.write(`\r${Math.min(i + BATCH, names.length)} of ${names.length}`);
    }
    process.stdout.write('\n');
  } finally {
    await browser.close();
    server.close();
  }
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join('; ')}`);

  const noFace = names.filter((name) => !detections[name].landmarks);
  const cache = {
    extractedAt: new Date().toISOString(),
    commit: execFileSync('git', ['-C', EVAL, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty,
    tasksVision: TASKS_VISION_VERSION,
    modelSha256: MODEL_SHA256,
    delegate: DELEGATE,
    options: LANDMARKER_OPTIONS,
    browser: userAgent,
    cpu: cpus()[0]?.model ?? 'unknown',
    memoryGB: Math.round(totalmem() / 2 ** 30),
    seconds: Math.round((performance.now() - started) / 1000),
    blockedRequestHosts: [...new Set(blockedRequests)],
    blockedRequestCount: blockedRequests.length,
    images: names.length,
    noFace: noFace.length,
    detections,
  };
  mkdirSync(dirname(LANDMARK_CACHE), { recursive: true });
  writeFileSync(LANDMARK_CACHE, JSON.stringify(cache));
  console.log(`${names.length} images, ${noFace.length} with no face, ${blockedRequests.length} blocked requests; wrote ${LANDMARK_CACHE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
