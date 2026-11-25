// A visitor who never touches the pointer: from the catalogue into a frame,
// through every recovery action of a blocked camera, to the photo view and
// back, and out to the catalogue. Each Tab stop must show focus, every
// control must be reachable, and Tab must not get stuck. Chromium only, since
// it is the engine that opens the try-on with a real permission denial and
// leaves buttons in the Tab order.
import { PRODUCTS, expect, status, test } from './support.mjs';

test.use({ permissions: [] });

const MAX_TABS = 40;

// The focused element as a person would name it, and whether the browser
// shows it as focused.
const focused = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    return {
      name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' '),
      tag: element.tagName.toLowerCase(),
      ring: element.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
    };
  });

/** Presses Tab until the control named `name` has focus; every stop must show a ring. */
const tabTo = async (page, name) => {
  const seen = [];
  for (let presses = 0; presses < MAX_TABS; presses += 1) {
    await page.keyboard.press('Tab');
    const stop = await focused(page);
    if (!stop) continue;
    expect(stop.ring, `no visible focus on "${stop.name}"`).toBe(true);
    if (stop.name === name) return seen;
    seen.push(stop.name);
  }
  throw new Error(`Tab never reached "${name}" in ${MAX_TABS} presses; it passed ${seen.join(' | ')}`);
};

/** The controls Tab visits from the top of the page, up to where the order repeats. */
const tabOrder = async (page) => {
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  const order = [];
  for (let presses = 0; presses < MAX_TABS; presses += 1) {
    await page.keyboard.press('Tab');
    const stop = await focused(page);
    if (!stop) break;
    expect(stop.ring, `no visible focus on "${stop.name}"`).toBe(true);
    if (order.includes(stop.name)) break;
    order.push(stop.name);
  }
  expect(order.length, 'Tab order never ended or repeated').toBeLessThan(MAX_TABS);
  return order;
};

test('opens a frame, reaches every recovery action, switches to a photo and back, and returns to the catalogue', async ({ app }) => {
  const { page } = app;
  await page.goto('/');
  await page.getByRole('heading', { name: PRODUCTS[0].name }).waitFor();

  // Catalogue to the first frame.
  await tabTo(page, 'Open Try-On');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/try-on\/\d+$/);
  await status(page, 'cameraDenied');

  // Every recovery action of the blocked camera is on the Tab path.
  expect(await tabOrder(page)).toEqual(expect.arrayContaining(['Back', 'Try again', 'Use a photo', 'Back to catalogue']));

  // Photo mode and back.
  await tabTo(page, 'Use a photo');
  await page.keyboard.press('Enter');
  await status(page, 'photoChoosing');
  expect(await tabOrder(page)).toEqual(expect.arrayContaining(['Choose a photo', 'Use the camera', 'Back to catalogue']));
  await tabTo(page, 'Use the camera');
  await page.keyboard.press('Enter');
  await status(page, 'cameraDenied');

  // Out to the catalogue.
  await tabTo(page, 'Back to catalogue');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('heading', { name: PRODUCTS[0].name }).waitFor();
});
