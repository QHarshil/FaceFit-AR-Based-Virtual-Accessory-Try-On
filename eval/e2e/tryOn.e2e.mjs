// Failure modes of the try-on in headless Chrome, with the public-domain
// stand-in portrait as the fake camera. The production build is served by
// `vite preview`, which sends the production CSP; the API is answered by
// route handlers, so a request can be failed on demand.
//
//   node eval/fixtures/build.mjs --source standin     (once: the clip and portrait)
//   npm --prefix eval run e2e
//
// FACEFIT_STANDIN_DIR points at another checkout's eval/.cache/clips/standin.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { offDeviceRequests } from '../harness/network.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(EVAL, '..');
const FRONTEND = join(REPO, 'frontend');
const STANDIN = resolve(process.env.FACEFIT_STANDIN_DIR ?? join(EVAL, '.cache', 'clips', 'standin'));
const CLIP = join(STANDIN, 'still.y4m');
const PORTRAIT = join(STANDIN, 'portrait.jpg');
const DIST = join(EVAL, '.cache', 'e2e-dist');
const API = 'http://localhost:5099';
const WEB_PORT = 4199;
const APP = `http://localhost:${WEB_PORT}`;
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

// The catalog as the backend serves it (backend/src/db/seed.ts).
const PRODUCTS = JSON.parse(readFileSync(join(REPO, 'assets', 'catalog.json'), 'utf8')).models.map(
  (model) => ({
    id: model.id,
    slug: model.slug,
    name: model.name,
    description: model.description,
    category: 'glasses',
    type: 'glasses',
    modelPath: `/models/${model.slug}.glb`,
    dimensionsMm: {
      total: model.totalWidthMm,
      lensWidth: model.lensWidthMm,
      lensHeight: model.lensHeightMm,
      bridge: model.bridgeMm,
      templeLength: model.templeLengthMm,
    },
    dimensionsSource: model.dimensionsSource,
    bridgeOriginMm: model.bridgeOriginMm,
    anchors: model.anchors,
    attribution: model.attribution,
  }),
);

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': APP },
  body: JSON.stringify(body),
});

let preview;
let browser;

const launch = (args = []) =>
  chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${CLIP}`,
      '--autoplay-policy=no-user-gesture-required',
      ...args,
    ],
  });

/** A page with probe and CSP recording, and the API served by route handlers. */
const open = async (target = browser, { camera = true } = {}) => {
  const context = await target.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: camera ? ['camera'] : [],
  });
  await context.addInitScript(() => {
    window.__events = [];
    window.__facefitProbe = (event) => window.__events.push({ ...event, at: performance.now() });
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__csp.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  const requests = [];
  context.on('request', (request) => requests.push(request.url()));
  await context.route(`${API}/api/products`, (route) => route.fulfill(json(PRODUCTS)));
  await context.route(new RegExp(`^${API}/api/products/(\\d+)$`), (route) => {
    const id = Number(route.request().url().split('/').pop());
    const product = PRODUCTS.find((item) => item.id === id);
    return route.fulfill(product ? json(product) : json({ error: 'Product not found' }, 404));
  });
  await context.route(`${API}/api/telemetry`, (route) => route.fulfill(json({ status: 'accepted' }, 202)));
  const page = await context.newPage();
  return { context, page, requests };
};

const status = (page, name, timeout = 60_000) =>
  page.locator(`[data-status="${name}"]`).waitFor({ timeout });

const countEvents = (page, stage) =>
  page.evaluate((name) => window.__events.filter((event) => event.stage === name).length, stage);

// axe-core calls eval, which the production CSP refuses. On a page the test
// injected axe into, that report comes from the test's script, not the app.
const axePages = new WeakSet();

const axeViolations = async (page) => {
  axePages.add(page);
  await page.evaluate(AXE);
  const { violations } = await page.evaluate(() => window.axe.run(document));
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(', ')}`);
};

const assertStayedOnDevice = async ({ page, requests }) => {
  assert.deepEqual(offDeviceRequests(requests), []);
  const reports = await page.evaluate(() => window.__csp);
  const fromAxe = (report) => axePages.has(page) && report === 'script-src eval';
  assert.deepEqual(reports.filter((report) => !fromAxe(report)), []);
};

before(async () => {
  for (const file of [CLIP, PORTRAIT]) {
    assert.ok(existsSync(file), `${file} is missing; run node eval/fixtures/build.mjs --source standin`);
  }
  execFileSync('npm', ['run', 'build', '--', '--outDir', DIST, '--emptyOutDir'], {
    cwd: FRONTEND,
    env: { ...process.env, VITE_API_URL: API },
    stdio: 'ignore',
  });
  preview = spawn(
    process.execPath,
    [join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--outDir', DIST, '--port', String(WEB_PORT), '--strictPort'],
    { cwd: FRONTEND, env: { ...process.env, VITE_API_URL: API }, stdio: 'ignore' },
  );
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(APP)).ok) break;
    } catch {
      if (attempt > 150) throw new Error('vite preview did not start');
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  browser = await launch(['--use-fake-ui-for-media-stream']);
});

after(async () => {
  await browser?.close();
  preview?.kill();
});

describe('try-on in Chrome with the stand-in face', () => {
  it('tracks the face, draws the overlay and passes axe on the catalogue and try-on', async () => {
    const session = await open();
    const { page } = session;
    await page.goto(APP);
    await page.getByRole('heading', { name: PRODUCTS[0].name }).waitFor();
    assert.deepEqual(await axeViolations(page), []);
    assert.ok(
      await page.getByRole('link', { name: PRODUCTS[0].attribution.title, exact: true }).first().isVisible(),
    );

    await page.goto(`${APP}/try-on/${PRODUCTS[0].id}`);
    await status(page, 'tracking');
    await page.waitForTimeout(1_000);
    assert.ok((await countEvents(page, 'renderedPose')) > 0, 'the overlay drew poses');
    assert.deepEqual(await axeViolations(page), []);
    await assertStayedOnDevice(session);
    await session.context.close();
  });

  it('recovers from a product request that fails on the network', async () => {
    const session = await open();
    const { page, context } = session;
    let fail = true;
    await context.route(`${API}/api/products/1`, (route) =>
      fail ? route.abort('internetdisconnected') : route.fallback(),
    );
    await page.goto(`${APP}/try-on/1`);
    await status(page, 'productUnavailable');
    assert.match(await page.getByRole('alert').innerText(), /Check your connection/);

    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('heading', { level: 1, name: PRODUCTS[0].name }).waitFor();
    await status(page, 'tracking');
    await session.context.close();
  });

  it('tells an unknown product from a network failure', async () => {
    const { page, context } = await open();
    await page.goto(`${APP}/try-on/999`);
    await status(page, 'productNotFound', 10_000);
    assert.equal(await page.getByRole('button', { name: 'Try again' }).count(), 0);
    await context.close();
  });

  it('offers a retry when the face model is missing and tracks after it', async () => {
    const session = await open();
    const { page, context } = session;
    let missing = true;
    await context.route(/face_landmarker\.task$/, (route) =>
      missing ? route.fulfill({ status: 404, body: 'not found' }) : route.fallback(),
    );
    await page.goto(`${APP}/try-on/1`);
    await status(page, 'modelFetchFailed');
    assert.deepEqual(await axeViolations(page), []);

    missing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await status(page, 'tracking');
    await context.close();
  });

  it('shows the loss of the WebGL context and resumes drawing when it is restored', async () => {
    const { page, context } = await open();
    await page.goto(`${APP}/try-on/1`);
    await status(page, 'tracking');

    await page.evaluate(() => {
      const gl = document.querySelector('canvas.overlay-canvas').getContext('webgl2');
      window.__loseContext = gl.getExtension('WEBGL_lose_context');
      window.__loseContext.loseContext();
    });
    await status(page, 'contextLost', 10_000);
    assert.equal(await page.locator('[data-status="tracking"]').count(), 0);

    await page.evaluate(() => window.__loseContext.restoreContext());
    await status(page, 'tracking', 10_000);
    const drawn = await countEvents(page, 'renderedPose');
    await page.waitForTimeout(1_000);
    assert.ok((await countEvents(page, 'renderedPose')) > drawn, 'drawing resumed');
    await context.close();
  });

  // Headless Chrome reports every tab as visible, so the test sets the
  // visibility the browser would report and fires the event it would fire.
  it('pauses the camera and inference while the tab is hidden and resumes after', async () => {
    const { page, context } = await open();
    await page.goto(`${APP}/try-on/1`);
    await status(page, 'tracking');

    const setHidden = (hidden) =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => (value ? 'hidden' : 'visible'),
        });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);

    await setHidden(true);
    await status(page, 'paused', 5_000);
    const track = () =>
      page.evaluate(() => {
        const video = document.querySelector('video');
        return { enabled: video.srcObject.getVideoTracks()[0].enabled, paused: video.paused };
      });
    assert.deepEqual(await track(), { enabled: false, paused: true });
    await page.waitForTimeout(300);
    const inferred = await countEvents(page, 'inference');
    await page.waitForTimeout(1_000);
    assert.equal(await countEvents(page, 'inference'), inferred, 'no inference while hidden');

    await setHidden(false);
    await status(page, 'tracking');
    assert.deepEqual(await track(), { enabled: true, paused: false });
    assert.ok((await countEvents(page, 'inference')) > inferred, 'inference resumed');
    await context.close();
  });
});

describe('try-on without camera access', () => {
  it('explains the blocked camera and tries on the stand-in portrait instead', async () => {
    const denied = await launch(['--deny-permission-prompts']);
    try {
      const session = await open(denied, { camera: false });
      const { page } = session;
      await page.goto(`${APP}/try-on/1`);
      await status(page, 'cameraDenied');
      assert.match(await page.getByRole('alert').innerText(), /Camera access is blocked/);
      assert.ok(await page.getByRole('button', { name: 'Try again' }).isVisible());
      assert.deepEqual(await axeViolations(page), []);

      await page.getByRole('button', { name: 'Use a photo' }).click();
      await status(page, 'photoChoosing');
      await page.getByLabel('Photo of your face').setInputFiles(PORTRAIT);
      await status(page, 'photoShowing');
      await page.waitForTimeout(500);
      assert.ok((await countEvents(page, 'renderedPose')) > 0, 'the overlay drew on the photo');
      await assertStayedOnDevice(session);
      await session.context.close();
    } finally {
      await denied.close();
    }
  });
});
