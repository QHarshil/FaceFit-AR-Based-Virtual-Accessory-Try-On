import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clsAt, firstOverlayMs, median, overBudget, totalBlockingTime } from './pageLoad.mjs';

test('blocking time counts only the part of a long task over 50 ms, after first paint, inside the window', () => {
  const tasks = [
    { startTime: 100, duration: 200 }, // before FCP
    { startTime: 600, duration: 120 }, // 70 ms
    { startTime: 900, duration: 40 }, // under 50 ms
    { startTime: 2_000, duration: 250 }, // 200 ms
    { startTime: 11_000, duration: 500 }, // after the window
  ];
  assert.equal(totalBlockingTime(tasks, 500), 270);
});

test('the median of an even count is the mean of the middle pair', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('a median over its budget, and a page with no measurement, are reported', () => {
  const medians = { catalogue: { lcpMs: 2600, cls: 0.02, tbtMs: 100 }, tryOn: { lcpMs: 900, cls: 0, tbtMs: 0 } };
  const budgets = {
    basis: 'text that explains the numbers',
    catalogue: { maxLcpMs: 2500, maxCls: 0.1, maxTbtMs: 200 },
    tryOn: { maxLcpMs: 2500 },
    missing: { maxLcpMs: 1 },
  };
  assert.deepEqual(overBudget(medians, budgets), ['catalogue lcpMs: 2600 > 2500', 'missing lcpMs: undefined > 1']);
});

test('the CLS in force at the first overlay ignores later shifts, and is 0 before any', () => {
  const series = [{ at: 800, value: 0.02 }, { at: 2_000, value: 0.03 }, { at: 9_000, value: 0.2 }];
  assert.equal(clsAt(series, 2_500), 0.03);
  assert.equal(clsAt(series, 500), 0);
  assert.equal(clsAt([], 500), 0);
});

test('the first overlay is the first rendered pose, and a page that drew none has no time', () => {
  const events = [{ stage: 'glassesPose', at: 1_000 }, { stage: 'renderedPose', at: 2_400 }, { stage: 'renderedPose', at: 2_433 }];
  assert.equal(firstOverlayMs(events), 2_400);
  assert.equal(firstOverlayMs(events.slice(0, 1)), null);
});

test('a try-on that never drew an overlay, or drew it late, is over budget', () => {
  const budgets = { tryOn: { maxOverlayMs: 5_000, maxClsToOverlay: 0.1 } };
  assert.deepEqual(overBudget({ tryOn: { overlayMs: 4_000, clsToOverlay: 0.03 } }, budgets), []);
  assert.deepEqual(overBudget({ tryOn: { overlayMs: 6_000, clsToOverlay: 0.03 } }, budgets), ['tryOn overlayMs: 6000 > 5000']);
  assert.deepEqual(overBudget({ tryOn: { clsToOverlay: 0.03 } }, budgets), ['tryOn overlayMs: undefined > 5000']);
});
