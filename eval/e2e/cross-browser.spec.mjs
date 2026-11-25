// What every engine runs: the catalogue, the 404 page, keyboard entry to a
// product, axe, and the try-on's first states. Chromium reads the stand-in
// portrait as its camera and Firefox its own generated stream, which holds no
// face, so Firefox stops at `searching`. WebKit has no fake camera in
// Playwright and reports the permission as denied; see denied.spec.mjs for
// what follows.
import { PRODUCTS, assertStayedOnDevice, axeViolations, expect, status, test } from './support.mjs';

test.describe('catalogue and routes', () => {
  test('lists the frames, links their credits and passes axe', async ({ app }) => {
    const { page } = app;
    await page.goto('/');
    for (const product of PRODUCTS) {
      await expect(page.getByRole('heading', { name: product.name })).toBeVisible();
    }
    await expect(
      page.getByRole('link', { name: PRODUCTS[0].attribution.title, exact: true }).first(),
    ).toBeVisible();
    await assertStayedOnDevice(app);
    expect(await axeViolations(page)).toEqual([]);
  });

  test('opens a frame from the keyboard', async ({ app, browserName }) => {
    test.skip(
      browserName === 'webkit',
      'WebKit leaves buttons out of the Tab order unless the system setting "Press Tab to highlight each item" is on, so Tab never reaches Open Try-On',
    );
    const { page } = app;
    await page.goto('/');
    await page.getByRole('heading', { name: PRODUCTS[0].name }).waitFor();
    const open = page.getByRole('button', { name: 'Open Try-On' }).first();
    for (let presses = 0; presses < 40; presses += 1) {
      await page.keyboard.press('Tab');
      if (await open.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(open).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/try-on\/\d+$/);
    await expect(page.getByRole('heading', { level: 1, name: /\S/ })).toBeVisible();
  });

  test('shows the not-found page for an unknown address and passes axe', async ({ app }) => {
    const { page } = app;
    await page.goto('/no-such-page');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await assertStayedOnDevice(app);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole('link', { name: 'Back to catalogue' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('tells an unknown product from a network failure', async ({ app }) => {
    const { page } = app;
    await page.goto('/try-on/999');
    await status(page, 'productNotFound', 10_000);
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('try-on with the camera granted', () => {
  test('starts the camera and passes axe', async ({ app, browserName }) => {
    test.skip(
      browserName === 'webkit',
      'Playwright WebKit has no fake camera: getUserMedia is denied without a grant, and there is no way to grant it',
    );
    const { page } = app;
    await page.goto('/try-on/1');
    await page.locator('[data-status="searching"], [data-status="tracking"]').first().waitFor({ timeout: 90_000 });
    await assertStayedOnDevice(app);
    expect(await axeViolations(page)).toEqual([]);
  });
});
