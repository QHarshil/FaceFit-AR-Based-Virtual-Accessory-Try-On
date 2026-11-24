// Runs MediaPipe FaceLandmarker over every frame of a Y4M clip in headless
// Chrome and caches the landmarks under eval/.cache/landmarks/clips/. VIDEO
// mode at the clip's frame rate, as in the app; CPU delegate so reruns match.
//
// Frames are served from 127.0.0.1 and every other request is aborted, so
// frames and landmarks stay on this machine.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { DELEGATE, MODEL_SHA256, TASKS_VISION_VERSION, ensureModel } from '../benchmark/extract-landmarks.mjs';
import { i420ToRgba, openY4m } from './y4m.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const TASKS_VISION_DIR = join(EVAL, 'node_modules', '@mediapipe', 'tasks-vision');
const MODEL_PATH = join(EVAL, '.cache', 'models', 'face_landmarker.task');
export const CLIP_LANDMARK_CACHE = join(EVAL, '.cache', 'landmarks', 'clips');
export const CLIP_LANDMARKER_OPTIONS = { runningMode: 'VIDEO', numFaces: 1 };
const BATCH = 30;

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { FaceLandmarker, FilesetResolver } from '/tasks-vision/vision_bundle.mjs';
const fileset = await FilesetResolver.forVisionTasks('/tasks-vision/wasm');
const landmarker = await FaceLandmarker.createFromOptions(fileset, {
  ...${JSON.stringify(CLIP_LANDMARKER_OPTIONS)},
  baseOptions: { modelAssetPath: '/model/face_landmarker.task', delegate: '${DELEGATE}' },
});
const round = (v) => Number(v.toPrecision(8));
window.detectFrames = async (start, end, width, height, fps) => {
  const faces = [];
  for (let index = start; index < end; index++) {
    const response = await fetch('/frame/' + index);
    const image = new ImageData(new Uint8ClampedArray(await response.arrayBuffer()), width, height);
    const face = landmarker.detectForVideo(image, (index * 1000) / fps).faceLandmarks[0];
    faces.push(face ? face.map((p) => [round(p.x), round(p.y)]) : null);
  }
  return faces;
};
window.landmarkerReady = true;
</script>`;

const ROUTES = [
  [/^\/tasks-vision\/(vision_bundle\.mjs)$/, (m) => join(TASKS_VISION_DIR, m[1])],
  [/^\/tasks-vision\/wasm\/(vision_wasm_[a-z_]+\.(?:js|wasm))$/, (m) => join(TASKS_VISION_DIR, 'wasm', m[1])],
  [/^\/model\/face_landmarker\.task$/, () => MODEL_PATH],
];
const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function serve(clip) {
  const rgba = new Uint8ClampedArray(clip.header.width * clip.header.height * 4);
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE);
      return;
    }
    const frame = path.match(/^\/frame\/(\d+)$/);
    if (frame && Number(frame[1]) < clip.frameCount) {
      const { width, height, fullRange } = clip.header;
      i420ToRgba(clip.readFrame(Number(frame[1])), width, height, fullRange, rgba);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.from(rgba.buffer));
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

/**
 * Landmarks for every frame of the clip, normalized [x, y] per landmark or
 * null where no face was found. Reuses the cache when the clip, package and
 * model are unchanged.
 */
export async function clipLandmarks(clipPath, log = () => {}) {
  const clipSha256 = await sha256File(clipPath);
  const cachePath = join(CLIP_LANDMARK_CACHE, `${basename(clipPath, '.y4m')}.json`);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (cached.clipSha256 === clipSha256 && cached.tasksVision === TASKS_VISION_VERSION && cached.modelSha256 === MODEL_SHA256 && cached.delegate === DELEGATE) {
      return cached;
    }
  }
  const installed = JSON.parse(readFileSync(join(TASKS_VISION_DIR, 'package.json'), 'utf8')).version;
  if (installed !== TASKS_VISION_VERSION) throw new Error(`@mediapipe/tasks-vision ${installed} installed, expected ${TASKS_VISION_VERSION}; run npm ci in eval/`);
  await ensureModel();

  const clip = openY4m(clipPath);
  const server = await serve(clip);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
  });
  const blockedRequests = [];
  const pageErrors = [];
  const frames = [];
  let userAgent;
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
    const { width, height, fps } = clip.header;
    for (let start = 0; start < clip.frameCount; start += BATCH) {
      const end = Math.min(start + BATCH, clip.frameCount);
      frames.push(...(await page.evaluate(([s, e, w, h, f]) => window.detectFrames(s, e, w, h, f), [start, end, width, height, fps])));
      log(`${basename(clipPath)}: ${end} of ${clip.frameCount} frames`);
    }
  } finally {
    await browser.close();
    server.close();
    clip.close();
  }
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join('; ')}`);

  const extraction = {
    extractedAt: new Date().toISOString(),
    commit: execFileSync('git', ['-C', EVAL, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    clipSha256,
    width: clip.header.width,
    height: clip.header.height,
    fps: clip.header.fps,
    tasksVision: TASKS_VISION_VERSION,
    modelSha256: MODEL_SHA256,
    delegate: DELEGATE,
    options: CLIP_LANDMARKER_OPTIONS,
    browser: userAgent,
    blockedRequestHosts: [...new Set(blockedRequests)],
    blockedRequestCount: blockedRequests.length,
    frames,
  };
  mkdirSync(CLIP_LANDMARK_CACHE, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(extraction));
  return extraction;
}
