// A visitor who never touches the pointer: from the catalogue into a frame,
// through every recovery action of a blocked camera, to the photo view and
// back, and out to the catalogue. Each Tab stop must show focus, every
// control must be reachable, and Tab must not get stuck. Chromium only, since
// it is the engine that opens the try-on with a real permission denial and
// leaves buttons in the Tab order.
import { PRODUCTS, assertStayedOnDevice, expect, status, test } from './support.mjs';

test.use({ permissions: [] });

const MAX_TABS = 40;

// What a keyboard can land on, in document order.
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

// The focused element as a person would name it, its place among the
// focusable elements, and whether the browser shows it as focused.
const focused = (page) =>
  page.evaluate((selector) => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    const reachable = [...document.querySelectorAll(selector)].filter(
      (candidate) => candidate.tabIndex >= 0 && !candidate.disabled && candidate.getClientRects().length > 0,
    );
    return {
      index: reachable.indexOf(element),
      name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' '),
      tag: element.tagName.toLowerCase(),
      ring: element.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
    };
  }, FOCUSABLE);

// Every focusable element on the page, named; the Tab cycle has to visit all of them.
const focusableNames = (page) =>
  page.evaluate((selector) =>
    [...document.querySelectorAll(selector)]
      .filter((candidate) => candidate.tabIndex >= 0 && !candidate.disabled && candidate.getClientRects().length > 0)
      .map((candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent ?? '').trim().replace(/\s+/g, ' ')),
  FOCUSABLE);

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

/**
 * The controls Tab visits from the top of the page, up to where the order
 * repeats. One cycle has to reach every focusable element on the page, so a
 * trap that skips the last links fails here.
 */
const tabOrder = async (page) => {
  // Moving focus to the body restarts Tab from the top; a blur alone leaves
  // the starting point at the control that had focus.
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
    window.scrollTo(0, 0);
  });
  const everything = await focusableNames(page);
  const visited = [];
  for (let presses = 0; presses < MAX_TABS; presses += 1) {
    await page.keyboard.press('Tab');
    const stop = await focused(page);
    if (!stop) break;
    expect(stop.ring, `no visible focus on "${stop.name}"`).toBe(true);
    if (visited.some((earlier) => earlier.index === stop.index)) break;
    visited.push(stop);
  }
  expect(visited.length, 'Tab order never ended or repeated').toBeLessThan(MAX_TABS);
  const reached = new Set(visited.map((stop) => stop.index));
  const missed = everything.filter((_, index) => !reached.has(index));
  expect(missed, `one Tab cycle skipped ${missed.join(' | ')}; it visited ${visited.map((stop) => stop.name).join(' | ')}`).toEqual([]);
  return visited.map((stop) => stop.name);
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
  await assertStayedOnDevice(app);
});
