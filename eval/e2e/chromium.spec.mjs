// Failure modes of the try-on in Chromium, with the public-domain stand-in
// portrait as the fake camera. The production build runs under `vite
// preview` with its CSP; the API is answered by route handlers, so a request
// can be failed on demand.
import {
  PORTRAIT,
  PRODUCTS,
  assertStayedOnDevice,
  axeViolations,
  countEvents,
  expect,
  status,
  test,
} from './support.mjs';

test.describe('try-on with the stand-in face', () => {
  test('tracks the face, draws the overlay and passes axe on the catalogue and try-on', async ({ app }) => {
    const { page } = app;
    await page.goto('/');
    await page.getByRole('heading', { name: PRODUCTS[0].name }).waitFor();
    await assertStayedOnDevice(app);
    expect(await axeViolations(page)).toEqual([]);
    await expect(
      page.getByRole('link', { name: PRODUCTS[0].attribution.title, exact: true }).first(),
    ).toBeVisible();

    await page.goto(`/try-on/${PRODUCTS[0].id}`);
    await status(page, 'tracking');
    await page.waitForTimeout(1_000);
    expect(await countEvents(page, 'renderedPose')).toBeGreaterThan(0);
    await assertStayedOnDevice(app);
    expect(await axeViolations(page)).toEqual([]);
  });

  test('recovers from a product request that fails on the network', async ({ app }) => {
    const { page, context } = app;
    let fail = true;
    await context.route('**/api/products/1', (route) =>
      fail ? route.abort('internetdisconnected') : route.fallback(),
    );
    await page.goto('/try-on/1');
    await status(page, 'productUnavailable');
    await expect(page.getByRole('alert')).toContainText('Check your connection');

    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('heading', { level: 1, name: PRODUCTS[0].name }).waitFor();
    await status(page, 'tracking');
  });

  test('tells an unknown product from a network failure', async ({ app }) => {
    const { page } = app;
    await page.goto('/try-on/999');
    await status(page, 'productNotFound', 10_000);
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('offers a retry when the face model is missing and tracks after it', async ({ app }) => {
    const { page, context } = app;
    let missing = true;
    await context.route(/face_landmarker\.task$/, (route) =>
      missing ? route.fulfill({ status: 404, body: 'not found' }) : route.fallback(),
    );
    await page.goto('/try-on/1');
    await status(page, 'modelFetchFailed');
    await assertStayedOnDevice(app);
    expect(await axeViolations(page)).toEqual([]);

    missing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await status(page, 'tracking');
  });

  test('shows the loss of the WebGL context and resumes drawing when it is restored', async ({ app }) => {
    const { page } = app;
    await page.goto('/try-on/1');
    await status(page, 'tracking');

    await page.evaluate(() => {
      const gl = document.querySelector('canvas.overlay-canvas').getContext('webgl2');
      window.__loseContext = gl.getExtension('WEBGL_lose_context');
      window.__loseContext.loseContext();
    });
    await status(page, 'contextLost', 10_000);
    await expect(page.locator('[data-status="tracking"]')).toHaveCount(0);

    await page.evaluate(() => window.__loseContext.restoreContext());
    await status(page, 'tracking', 10_000);
    const drawn = await countEvents(page, 'renderedPose');
    await page.waitForTimeout(1_000);
    expect(await countEvents(page, 'renderedPose')).toBeGreaterThan(drawn);
    await assertStayedOnDevice(app);
  });

  // Headless Chromium reports every tab as visible, so the test sets the
  // visibility the browser would report and fires the event it would fire.
  test('stops the camera and inference while the tab is hidden and resumes after', async ({ app }) => {
    const { page } = app;
    await page.goto('/try-on/1');
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

    // The track that was live before hiding, kept to check it was stopped.
    await page.evaluate(() => {
      window.__track = document.querySelector('video').srcObject.getVideoTracks()[0];
    });
    const camera = () =>
      page.evaluate(() => {
        const stream = document.querySelector('video').srcObject;
        const track = stream?.getVideoTracks()[0];
        return {
          before: window.__track.readyState,
          now: track ? track.readyState : null,
          sameTrack: track === window.__track,
        };
      });

    await setHidden(true);
    await status(page, 'paused', 5_000);
    expect(await camera()).toEqual({ before: 'ended', now: null, sameTrack: false });
    await page.waitForTimeout(300);
    const inferred = await countEvents(page, 'inference');
    await page.waitForTimeout(1_000);
    expect(await countEvents(page, 'inference')).toBe(inferred);

    await setHidden(false);
    await status(page, 'tracking');
    expect(await camera()).toEqual({ before: 'ended', now: 'live', sameTrack: false });
    expect(await countEvents(page, 'inference')).toBeGreaterThan(inferred);
    await assertStayedOnDevice(app);
  });
});

test.describe('try-on without camera access', () => {
  // The camera permission is not granted, so the browser blocks getUserMedia.
  test.use({ permissions: [] });

  test('explains the blocked camera and tries on the stand-in portrait instead', async ({ app }) => {
    const { page } = app;
    await page.goto('/try-on/1');
    await status(page, 'cameraDenied');
    await expect(page.getByRole('alert')).toContainText('Camera access is blocked');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await assertStayedOnDevice(app);
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Use a photo' }).click();
    await status(page, 'photoChoosing');
    await page.getByLabel('Photo of your face').setInputFiles(PORTRAIT);
    await status(page, 'photoShowing');
    await page.waitForTimeout(500);
    expect(await countEvents(page, 'renderedPose')).toBeGreaterThan(0);
    await assertStayedOnDevice(app);
    expect(await axeViolations(page)).toEqual([]);
  });
});
