// axe on every page and on the try-on in each status a visitor can be left
// in, failing on serious and critical violations. Chromium only: it is the
// engine that tracks the stand-in face and reaches all of these states; the
// other engines run axe on the pages they reach in cross-browser.spec.mjs and
// denied.spec.mjs.
import { PORTRAIT, PRODUCTS, assertStayedOnDevice, axeViolations, expect, status, test } from './support.mjs';

const settled = async (app, name) => {
  await status(app.page, name);
  await assertStayedOnDevice(app);
  expect(await axeViolations(app.page)).toEqual([]);
};

test.describe('pages', () => {
  test('catalogue', async ({ app }) => {
    await app.page.goto('/');
    await app.page.getByRole('heading', { name: PRODUCTS[0].name }).waitFor();
    await assertStayedOnDevice(app);
    expect(await axeViolations(app.page)).toEqual([]);
  });

  test('not found', async ({ app }) => {
    await app.page.goto('/no-such-page');
    await app.page.getByRole('heading', { level: 1, name: 'Page not found' }).waitFor();
    expect(await axeViolations(app.page)).toEqual([]);
  });
});

test.describe('try-on statuses', () => {
  test('tracking', async ({ app }) => {
    await app.page.goto('/try-on/1');
    await settled(app, 'tracking');
  });

  test('searching, with a camera that shows no face', async ({ app }) => {
    // A flat grey canvas as the camera: bright enough to avoid the low-light
    // status, and without a face.
    await app.page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext('2d');
        const draw = () => {
          context.fillStyle = '#808080';
          context.fillRect(0, 0, canvas.width, canvas.height);
          requestAnimationFrame(draw);
        };
        draw();
        return canvas.captureStream(30);
      };
    });
    await app.page.goto('/try-on/1');
    await settled(app, 'searching');
  });

  test('model failed', async ({ app }) => {
    await app.context.route(/face_landmarker\.task$/, (route) => route.fulfill({ status: 404, body: 'not found' }));
    await app.page.goto('/try-on/1');
    await settled(app, 'modelFetchFailed');
  });

  test('product not found', async ({ app }) => {
    await app.page.goto('/try-on/999');
    await settled(app, 'productNotFound');
  });

  test.describe('without camera access', () => {
    test.use({ permissions: [] });

    test('camera denied', async ({ app }) => {
      await app.page.goto('/try-on/1');
      await settled(app, 'cameraDenied');
    });

    test('photo showing', async ({ app }) => {
      const { page } = app;
      await page.goto('/try-on/1');
      await status(page, 'cameraDenied');
      await page.getByRole('button', { name: 'Use a photo' }).click();
      await page.getByLabel('Photo of your face').setInputFiles(PORTRAIT);
      await settled(app, 'photoShowing');
    });
  });
});
