// Browser tests of the production build. Chromium gets the stand-in portrait
// as its fake camera; Firefox gets its own generated stream and WebKit none,
// so only Chromium runs the face-tracking cases (see e2e/README in
// eval/README.md for what each engine skips).
//
//   node fixtures/build.mjs --source standin
//   npx playwright test --project chromium
//
// FACEFIT_STANDIN_DIR reads the clips from another checkout. FACEFIT_CHROME
// names an installed browser channel (for example `chrome`); without it
// Playwright's own Chromium runs.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const EVAL = dirname(fileURLToPath(import.meta.url));
const STANDIN = resolve(process.env.FACEFIT_STANDIN_DIR ?? join(EVAL, '.cache', 'clips', 'standin'));
const WEB_PORT = 4199;
// Specs every engine runs; the rest need the stand-in camera and run on Chromium only.
const CROSS_BROWSER = ['cross-browser.spec.mjs'];
const DENIED = ['denied.spec.mjs'];
const LAYOUT = ['layout.spec.mjs'];

// A runner has no GPU, and Firefox blocks software WebGL unless told otherwise.
// Harmless where a GPU exists.
const FIREFOX_SOFTWARE_WEBGL = { 'webgl.force-enabled': true, 'webgl.forbid-software': false };

// Firefox's generated stream, granted without a prompt.
const FIREFOX_FAKE_CAMERA = {
  'media.navigator.streams.fake': true,
  'media.navigator.permission.disabled': true,
  ...FIREFOX_SOFTWARE_WEBGL,
};

// New headless mode, unlike the headless shell, honours camera grants and denials.
const chromium = ({ granted, clip = 'still' }) => ({
  channel: process.env.FACEFIT_CHROME || 'chromium',
  permissions: granted ? ['camera'] : [],
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${join(STANDIN, `${clip}.y4m`)}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

export default defineConfig({
  testDir: join(EVAL, 'e2e'),
  testMatch: '*.spec.mjs',
  outputDir: join(EVAL, '.cache', 'playwright'),
  // Inference is CPU bound; parallel pages would measure each other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: join(EVAL, '.cache', 'playwright-report') }]] : 'list',
  webServer: {
    command: `node ${join(EVAL, 'e2e', 'serve.mjs')}`,
    url: `http://localhost:${WEB_PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { FACEFIT_E2E_PORT: String(WEB_PORT) },
  },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: [...DENIED, ...LAYOUT],
      use: chromium({ granted: true }),
    },
    { name: 'chromium-denied', testMatch: DENIED, use: chromium({ granted: false }) },
    // The harness's viewport, where the cover crop is the identity: the control for the other two.
    { name: 'chromium-desktop', testMatch: LAYOUT, use: chromium({ granted: true }) },
    // The stand-in face at the centre of the frame, in a portrait phone.
    {
      name: 'chromium-phone',
      testMatch: LAYOUT,
      use: { ...chromium({ granted: true }), viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    // The face 160 px right of centre in a landscape phone, so the mirror moves it off the middle.
    {
      name: 'chromium-landscape',
      testMatch: LAYOUT,
      use: { ...chromium({ granted: true, clip: 'dx160' }), viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    {
      name: 'firefox',
      testMatch: CROSS_BROWSER,
      use: { browserName: 'firefox', launchOptions: { firefoxUserPrefs: FIREFOX_FAKE_CAMERA } },
    },
    {
      name: 'firefox-denied',
      testMatch: DENIED,
      use: { browserName: 'firefox', launchOptions: { firefoxUserPrefs: { 'permissions.default.camera': 2, ...FIREFOX_SOFTWARE_WEBGL } } },
    },
    { name: 'webkit', testMatch: [...CROSS_BROWSER, ...DENIED], use: { browserName: 'webkit' } },
  ],
});
