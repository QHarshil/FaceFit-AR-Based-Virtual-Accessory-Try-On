import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROBE_ORDER, blinkShift, findBlinks, outsideBlinks, landmarkToPx, latency, linearFit, ndcToPx, percentile, pointJitter,
  rotationJitter, windowSamples, wrapLineAngle,
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

test('latency follows a frame from capture through the worker to the first render after its pose', () => {
  const events = [
    { stage: 'render', start: 0, end: 1 },
    { stage: 'capture', frameId: 0, start: 2, end: 2.5 },
    { stage: 'frameToLandmarks', frameId: 0, start: 2, end: 14 },
    { stage: 'inference', frameId: 0, durationMs: 10 },
    { stage: 'result', frameId: 0, start: 14, end: 15 },
    { stage: 'pose', start: 14.2, end: 14.8 },
    { stage: 'render', start: 16.7, end: 18 },
    { stage: 'capture', frameId: 1, start: 35.3, end: 35.6 },
    { stage: 'capture', frameId: 2, start: 68.6, end: 68.9 },
    { stage: 'drop', frameId: 1 },
    { stage: 'frameToLandmarks', frameId: 2, start: 68.6, end: 80 },
    { stage: 'inference', frameId: 2, durationMs: 9 },
    { stage: 'result', frameId: 2, start: 80, end: 80.5 },
    { stage: 'render', start: 83.4, end: 84 },
  ];
  const result = latency(events, 0.1);
  // Frame 2 found no face, so it has no pose and no pipeline sample.
  assert.equal(result.pipelineMs.n, 1);
  close(result.pipelineMs.p50, 16);
  close(result.mainThreadPerFrameMs.p50, (1.5 + 0.8) / 2);
  close(result.inferenceMs.p50, 9.5);
  close(result.frameToLandmarksMs.p50, (12 + 11.4) / 2);
  close(result.captureIntervalMs.p50, 33.3, 1e-6);
  close(result.inferenceIntervalMs.p50, 66);
  assert.equal(result.framesDropped, 1);
  assert.deepEqual(result.ratesHz, { capture: 30, inference: 20, render: 30 });
});

test('the pipeline steps of a frame add up to its pipeline time', () => {
  const events = [
    { stage: 'capture', frameId: 0, start: 2, end: 2.5 },
    { stage: 'frameToPost', frameId: 0, start: 2, end: 2.4 },
    { stage: 'inference', frameId: 0, durationMs: 12, start: 3, end: 15 },
    { stage: 'frameToLandmarks', frameId: 0, start: 2, end: 15.5 },
    { stage: 'result', frameId: 0, start: 15.5, end: 16 },
    { stage: 'pose', start: 15.6, end: 15.9 },
    { stage: 'render', start: 16.7, end: 17.2 },
  ];
  const { pipelineMs, pipelineStepsMs } = latency(events);
  const steps = Object.fromEntries(Object.entries(pipelineStepsMs).map(([step, s]) => [step, s.mean]));
  close(steps.frameToPost, 0.4);
  close(steps.queue, 0.6);
  close(steps.inference, 12);
  close(steps.delivery, 0.5);
  close(steps.resultToRender, 1.7);
  close(Object.values(steps).reduce((s, v) => s + v, 0), pipelineMs.p50);
});

test('frames without worker timings still count for the pipeline but not its steps', () => {
  const events = [
    { stage: 'frameToLandmarks', frameId: 0, start: 0, end: 10 },
    { stage: 'inference', frameId: 0, durationMs: 9 },
    { stage: 'result', frameId: 0, start: 10, end: 11 },
    { stage: 'pose', start: 10.1, end: 10.9 },
    { stage: 'render', start: 16.7, end: 17 },
  ];
  const { pipelineMs, pipelineStepsMs } = latency(events);
  assert.equal(pipelineMs.n, 1);
  assert.equal(pipelineStepsMs.queue.n, 0);
  assert.equal(pipelineStepsMs.queue.mean, null);
});

test('a render that starts before the result is handled does not count for that frame', () => {
  const events = [
    { stage: 'capture', frameId: 0, start: 0, end: 0.2 },
    { stage: 'frameToLandmarks', frameId: 0, start: 0, end: 10 },
    { stage: 'render', start: 9, end: 9.5 },
    { stage: 'result', frameId: 0, start: 10, end: 11 },
    { stage: 'pose', start: 10.1, end: 10.9 },
    { stage: 'render', start: 25.7, end: 26 },
  ];
  close(latency(events).pipelineMs.p50, 26);
});

test('windowSamples keeps the moving-average span near 150 ms at 60 Hz and 30 Hz', () => {
  const times = (interval) => Array.from({ length: 20 }, (_, i) => i * interval);
  assert.equal(windowSamples(times(1000 / 60)), 9);
  assert.equal(windowSamples(times(1000 / 30)), 5);
  assert.equal(windowSamples([0]), 3);
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
  const source = await readFile(new URL('../../frontend/src/components/ARTryOn.tsx', import.meta.url), 'utf8');
  const match = source.match(/PROBE_LANDMARKS = \[([^\]]+)\]/);
  assert.deepEqual(match[1].split(',').map(Number), PROBE_ORDER);
});
