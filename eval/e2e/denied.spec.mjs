// A blocked camera leads to the photo fallback. The block is real in each
// engine: Chromium with no permission granted, Firefox with
// `permissions.default.camera` set to block, WebKit by default because
// Playwright cannot grant it.
//
// Firefox's page crashes when axe-core 4.14.1 runs on the photo view under
// Playwright's Firefox 159 (its wcag2a, ARIA and keyboard rule groups each
// trigger it; the blocked-camera view is fine), so that one check is skipped
// there and recorded as an annotation. Chromium and WebKit run it.
import { PORTRAIT, assertStayedOnDevice, axeViolations, countEvents, expect, status, test } from './support.mjs';

test('explains the blocked camera and tries on the stand-in portrait instead', async ({ app, browserName }) => {
  const { page } = app;
  await page.goto('/try-on/1');
  await status(page, 'cameraDenied');
  await expect(page.getByRole('alert')).toContainText('Camera access is blocked');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await assertStayedOnDevice(app);

  await page.getByRole('button', { name: 'Use a photo' }).click();
  await status(page, 'photoChoosing');
  await page.getByLabel('Photo of your face').setInputFiles(PORTRAIT);
  await status(page, 'photoShowing', 90_000);
  await page.waitForTimeout(500);
  expect(await countEvents(page, 'renderedPose')).toBeGreaterThan(0);
  await assertStayedOnDevice(app);
  if (browserName === 'firefox') {
    test.info().annotations.push({ type: 'skipped', description: 'axe on the photo view crashes Playwright Firefox' });
  } else {
    expect(await axeViolations(page)).toEqual([]);
  }
});

test('passes axe on the blocked-camera state', async ({ app }) => {
  const { page } = app;
  await page.goto('/try-on/1');
  await status(page, 'cameraDenied');
  await assertStayedOnDevice(app);
  expect(await axeViolations(page)).toEqual([]);
});
