import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROBE_ORDER, blinkShift, findBlinks, outsideBlinks, landmarkToPx, latency, linearFit, ndcToPx, percentile, pointJitter,
  rotationJitter, wrapLineAngle,
} from './metrics.mjs';

const close = (actual, expected, tol = 1e-9) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);

test('percentile interpolates between ranks', () => {
  close(percentile([1, 2, 3, 4], 50), 2.5);
  close(percentile([10, 0, 5], 95), 9.5);
  assert.equal(percentile([], 50), null);
});

test('landmarkToPx applies object-fit cover crop', () => {
  // 16:9 video in a 1:1 viewport: scale by height, crop the sides.
  const [x, y] = landmarkToPx([0.5, 0.25], [1280, 720], [720, 720]);
  close(x, 360);
  close(y, 180);
  const [left] = landmarkToPx([0, 0], [1280, 720], [720, 720]);
  close(left, -280);
});

test('ndcToPx maps the NDC square onto the viewport with y down', () => {
  assert.deepEqual(ndcToPx([-1, 1], [1280, 720]), [0, 0]);
  assert.deepEqual(ndcToPx([1, -1], [1280, 720]), [1280, 720]);
});

test('linearFit recovers slope and intercept', () => {
  const { slope, intercept } = linearFit([0, 1, 2, 3], [1, 3, 5, 7]);
  close(slope, 2);
  close(intercept, 1);
});

test('wrapLineAngle treats a reversed line as the same line', () => {
  close(wrapLineAngle(175), -5);
  close(wrapLineAngle(-170), 10);
  close(wrapLineAngle(30), 30);
});

test('pointJitter of alternating points', () => {
  const { rmsFromMean, rmsStep } = pointJitter([[0, 0], [2, 0], [0, 0], [2, 0]]);
  close(rmsFromMean, 1);
  close(rmsStep, 2);
});

test('pointJitter high-pass ignores a steady drift', () => {
  const drift = Array.from({ length: 50 }, (_, i) => [i * 0.5, 0]);
  const { rmsFromMean, rmsHighPass } = pointJitter(drift.slice(0, 50), 9);
  assert.ok(rmsFromMean > 5);
  // Only the truncated windows at the ends deviate from a linear trend.
  assert.ok(rmsHighPass < 0.4, `high-pass ${rmsHighPass}`);
});

test('outsideBlinks masks each blink with a margin', () => {
  assert.deepEqual(outsideBlinks(10, [[4, 5]], 1), [0, 1, 2, 7, 8, 9]);
});

test('rotationJitter recovers a known oscillation about one axis', () => {
  const quat = (deg) => {
    const half = (deg * Math.PI) / 360;
    return [0, 0, Math.sin(half), Math.cos(half)];
  };
  // +-1 degree about z, with sign flips that must not count as rotation.
  const quats = [quat(1), quat(-1), quat(1).map((v) => -v), quat(-1)];
  const { rmsFromMean, rmsStep } = rotationJitter(quats);
  close(rmsFromMean, 1, 1e-6);
  close(rmsStep, 2, 1e-6);
});

test('latency pairs each frame with the first render after its pose', () => {
  const events = [
    { stage: 'render', start: 0, end: 1 },
    { stage: 'send', start: 2, end: 10 },
    { stage: 'pose', start: 8, end: 9 },
    { stage: 'render', start: 16, end: 18 },
    { stage: 'send', start: 20, end: 30 },
    { stage: 'pose', start: 28, end: 29 },
    { stage: 'render', start: 33, end: 34 },
  ];
  const result = latency(events);
  assert.equal(result.pipelineMs.n, 2);
  close(result.pipelineMs.p50, 15);
  close(result.inferenceMs.p50, 9);
  close(result.renderIntervalMs.p50, 16.5);
});

test('findBlinks and blinkShift locate a dip and its displacement', () => {
  const openness = [...Array(12).fill(0.3), 0.05, 0.04, ...Array(10).fill(0.3)];
  const blinks = findBlinks(openness);
  assert.deepEqual(blinks, [[12, 13]]);
  const ys = openness.map((v, i) => (i >= 12 && i <= 14 ? 104 : 100));
  assert.deepEqual(blinkShift(ys, blinks), [4]);
});

test('probe landmark order matches the app', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../frontend/src/components/ARTryOn.js', import.meta.url), 'utf8');
  const match = source.match(/PROBE_LANDMARKS = \[([^\]]+)\]/);
  assert.deepEqual(match[1].split(',').map(Number), PROBE_ORDER);
});
