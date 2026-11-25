import assert from 'node:assert/strict';
import { test } from 'node:test';
import { median, overBudget, totalBlockingTime } from './pageLoad.mjs';

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
    catalogue: { maxLcpMs: 2500, maxCls: 0.1, maxTbtMs: 200 },
    tryOn: { maxLcpMs: 2500 },
    missing: { maxLcpMs: 1 },
  };
  assert.deepEqual(overBudget(medians, budgets), ['catalogue lcpMs: 2600 > 2500', 'missing lcpMs: undefined > 1']);
});
