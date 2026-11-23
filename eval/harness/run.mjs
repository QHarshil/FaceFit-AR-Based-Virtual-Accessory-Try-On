// Runs the try-on page in Chrome with a clip as the fake camera and collects
// probe events (see frontend/src/utils/probe.js).
import { chromium } from 'playwright-core';

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

export const runCondition = async ({ clip, url, warmupSeconds, measureSeconds, headless = true, screenshot }) => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${clip}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera'] });
    await context.addInitScript(() => {
      window.__facefitEvents = [];
      window.__facefitProbe = (event) => window.__facefitEvents.push(event);
    });
    const page = await context.newPage();
    const assets = [];
    const errors = [];
    page.on('response', (res) => {
      if (res.url().includes('mediapipe')) assets.push({ url: res.url(), status: res.status() });
    });
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));

    await page.goto(url);
    await page.waitForFunction(
      () => window.__facefitEvents.some((e) => e.stage === 'glassesPose'),
      null,
      { timeout: 60000 },
    );
    await page.waitForTimeout(warmupSeconds * 1000);
    await page.evaluate(() => { window.__facefitEvents.length = 0; });
    await page.waitForTimeout(measureSeconds * 1000);
    const events = await page.evaluate(() => window.__facefitEvents.splice(0));
    const environment = await page.evaluate(describeEnvironment);
    environment.cameraFps = await page.evaluate(measureCameraFps);
    if (screenshot) await page.screenshot({ path: screenshot });
    return { events, environment, assets, errors };
  } finally {
    await browser.close();
  }
};
