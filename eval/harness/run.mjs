// Runs the try-on page in Chrome with a clip as the fake camera and collects
// probe events (see frontend/src/utils/probe.ts), every request the page and
// its worker make, requests the worker's same-origin guard blocked, and CSP
// violations on the page.
import { chromium } from 'playwright-core';
import { guardOutcome, offDeviceRequests } from './network.mjs';

const describeEnvironment = () => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const video = document.querySelector('video');
  return {
    userAgent: navigator.userAgent,
    webglRenderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
    video: video ? [video.videoWidth, video.videoHeight] : null,
  };
};

// Frames per second the video element presents, over one second.
const measureCameraFps = () => new Promise((resolve) => {
  const video = document.querySelector('video');
  const start = performance.now();
  let frames = 0;
  const tick = () => {
    frames += 1;
    const elapsed = performance.now() - start;
    if (elapsed < 1000) video.requestVideoFrameCallback(tick);
    else resolve(frames / (elapsed / 1000));
  };
  video.requestVideoFrameCallback(tick);
});

const launch = (clip, extraArgs = [], headless = true) => chromium.launch({
  channel: 'chrome',
  headless,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${clip}`,
    '--autoplay-policy=no-user-gesture-required',
    ...extraArgs,
  ],
});

// A context that records probe events, every request (on the context, so the
// landmark worker's are included) and the guard's blocked attempts, which are
// kept for the whole session while probe events are cleared after warmup.
const instrumentedPage = async (browser) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera'] });
  await context.addInitScript(() => {
    window.__facefitEvents = [];
    window.__facefitBlocked = [];
    window.__facefitProbe = (event) => {
      if (event.stage === 'blockedRequest') window.__facefitBlocked.push({ ...event, t: performance.now() });
      window.__facefitEvents.push(event);
    };
    window.__facefitCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__facefitCspViolations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  const requests = [];
  context.on('request', (req) => requests.push(req.url()));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  return { context, page, requests, errors };
};

const blockedAttempts = (page) => page.evaluate(() => window.__facefitBlocked);

// Fails the first FaceLandmarker attempt and leaves the worker as a failed GPU
// start does: the loader module has run and ModuleFactory is cleared. Only the
// plain loader URL is replaced, so a retry under another URL gets the real one.
const FIRST_ATTEMPT_FAILURE = "\nglobalThis.ModuleFactory = async () => { globalThis.ModuleFactory = undefined; throw new Error('first delegate failed by the eval harness'); };\n";
const failFirstDelegate = (context) => context.route(/\/vision_wasm_module_internal\.js$/, async (route) => {
  if (route.request().method() !== 'GET') return route.fallback();
  const response = await route.fetch();
  return route.fulfill({ response, body: `${await response.text()}${FIRST_ATTEMPT_FAILURE}` });
});

// Reads the clip frame code (FRAME_CODE in conditions.mjs) of every frame
// the video presents, in a frame callback of its own: it sees the same
// mediaTime as the app's capture callback for that frame.
const startFrameCodeReader = ({ bits, blockPx }) => {
  const video = document.querySelector('video');
  const width = bits * blockPx;
  const context = new OffscreenCanvas(width, blockPx).getContext('2d', { willReadFrequently: true });
  window.__facefitFrameCodes = [];
  const read = (now, metadata) => {
    video.requestVideoFrameCallback(read);
    context.drawImage(video, 0, 0, width, blockPx, 0, 0, width, blockPx);
    const pixels = context.getImageData(0, 0, width, blockPx).data;
    let code = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      const centre = ((blockPx >> 1) * width + bit * blockPx + (blockPx >> 1)) * 4;
      if (pixels[centre] > 128) code |= 1 << bit;
    }
    window.__facefitFrameCodes.push({ mediaTime: metadata.mediaTime, code, t: now });
  };
  video.requestVideoFrameCallback(read);
};

export const runCondition = async ({ clip, url, warmupSeconds, measureSeconds, headless = true, screenshot, failFirstAttempt = false, frameCode = null }) => {
  const browser = await launch(clip, [], headless);
  try {
    const { context, page, requests, errors } = await instrumentedPage(browser);
    if (failFirstAttempt) await failFirstDelegate(context);

    await page.goto(url);
    await page.waitForFunction(
      () => window.__facefitEvents.some((e) => e.stage === 'glassesPose'),
      null,
      { timeout: 60000 },
    );
    const ready = await page.evaluate(() => window.__facefitEvents.find((e) => e.stage === 'perceptionReady'));
    if (frameCode) await page.evaluate(startFrameCodeReader, frameCode);
    await page.waitForTimeout(warmupSeconds * 1000);
    // The warmup's events let an offline replay start with a settled filter.
    const warmupEvents = await page.evaluate(() => {
      if (window.__facefitFrameCodes) window.__facefitFrameCodes.length = 0;
      return window.__facefitEvents.splice(0);
    });
    await page.waitForTimeout(measureSeconds * 1000);
    const events = await page.evaluate(() => window.__facefitEvents.splice(0));
    const frameCodes = frameCode ? await page.evaluate(() => window.__facefitFrameCodes.splice(0)) : null;
    const environment = await page.evaluate(describeEnvironment);
    environment.cameraFps = await page.evaluate(measureCameraFps);
    if (screenshot) await page.screenshot({ path: screenshot });
    // A fetch the CSP blocks inside the worker raises no request event, no
    // page violation and no page console error, so only page violations count.
    const cspViolations = [
      ...(await page.evaluate(() => window.__facefitCspViolations)),
      ...errors.filter((text) => text.includes('Content Security Policy')),
    ];
    const blocked = (await blockedAttempts(page)).map((e) => `${e.api} ${e.url}`);
    return { events, warmupEvents, frameCodes, environment, delegate: ready ? ready.delegate : null, requests, blocked, cspViolations, errors };
  } finally {
    await browser.close();
  }
};

const SELF_TEST_URLS = { fetch: 'https://guard-selftest.invalid/fetch', xhr: 'https://guard-selftest.invalid/xhr' };
const USAGE_LOG_HOST = 'odml.pa.googleapis.com';

// Issues an off-origin fetch and XHR from inside the landmark worker and
// classifies each as blocked by the guard, seen as a request, or missed. Then
// waits for the MediaPipe usage log, which the package sends about a minute
// after start. Every host but localhost fails to resolve in this browser, so
// a request the guard misses still cannot leave the machine.
export const selfTestWorkerGuard = async ({ clip, url, usageLogTimeoutSeconds = 90 }) => {
  const browser = await launch(clip, ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost']);
  try {
    const { page, requests } = await instrumentedPage(browser);
    const worker = new Promise((resolve) => {
      page.on('worker', (w) => w.url().includes('landmarker.worker') && resolve(w));
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__facefitEvents.some((e) => e.stage === 'perceptionReady'), null, { timeout: 60000 });
    const thrown = await (await worker).evaluate(async (urls) => {
      const errors = {};
      try {
        await fetch(urls.fetch, { method: 'POST', body: 'self-test' });
      } catch (error) {
        errors.fetch = String(error);
      }
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', urls.xhr);
        xhr.send('self-test');
      } catch (error) {
        errors.xhr = String(error);
      }
      return errors;
    }, SELF_TEST_URLS);
    await page.waitForTimeout(1000);
    const blocked = (await blockedAttempts(page)).map((e) => e.url);
    const probes = Object.fromEntries(Object.entries(SELF_TEST_URLS).map(([api, target]) => [api, {
      url: target,
      outcome: guardOutcome(target, { blocked, requests }),
      thrown: thrown[api] ?? null,
    }]));

    const usageLog = await page.waitForFunction(
      (host) => window.__facefitBlocked.find((e) => e.url.includes(host)),
      USAGE_LOG_HOST,
      { timeout: usageLogTimeoutSeconds * 1000, polling: 500 },
    ).then((handle) => handle.jsonValue(), () => null);
    return {
      probes,
      usageLogBlockedAfterSeconds: usageLog ? usageLog.t / 1000 : null,
      blocked: (await blockedAttempts(page)).map((e) => `${e.api} ${e.url}`),
      offDevice: offDeviceRequests(requests),
    };
  } finally {
    await browser.close();
  }
};
