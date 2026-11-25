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
      use: {
        // New headless mode: unlike the headless shell it honours camera permission grants and denials.
        channel: process.env.FACEFIT_CHROME || 'chromium',
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${join(STANDIN, 'still.y4m')}`,
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
    {
      name: 'firefox',
      testMatch: CROSS_BROWSER,
      use: {
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
          },
        },
      },
    },
    { name: 'webkit', testMatch: CROSS_BROWSER },
  ],
});
