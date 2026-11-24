import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MOTION, motionExpression, motionPeriodFrames, motionTruth } from './conditions.mjs';
import {
  frameAt, frameSamples, fundamentalDelayMs, mediaTimeMismatchShare, motionMetrics, offsetError, presentationRate,
  presentedFrames, renderedSamples, stepResponses, triangleLagMs,
} from './motionMetrics.mjs';

const close = (actual, expected, tol = 1e-9) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);

// Evaluates the ffmpeg expressions the fixture builder uses, with ffmpeg's
// mod(x, y) = x - y * floor(x / y).
const evaluateFfmpeg = (expression, n) => {
  const js = expression
    .replace(/\bmod\(/g, 'mod(')
    .replace(/\bPI\b/g, 'Math.PI')
    .replace(/\b(sin|abs|floor)\(/g, 'Math.$1(');
  return new Function('n', 'mod', `return ${js};`)(n, (x, y) => x - y * Math.floor(x / y));
};

test('each motion clip draws exactly its truth function and loops without a jump', () => {
  for (const { id, motion, clipSeconds } of MOTION) {
    const frames = clipSeconds * 30;
    assert.equal(frames % motionPeriodFrames(motion), 0, id);
    for (let n = 0; n < frames; n += 1) close(evaluateFfmpeg(motionExpression(motion), n), motionTruth(motion, n), 1e-9);
    if (motion.axis === 'dx') {
      // The crop moves by whole source pixels, and yuv420p rounds odd ones down.
      for (let n = 0; n < frames; n += 1) assert.equal(Math.abs(motionTruth(motion, n) % 2), 0, `${id} frame ${n}`);
    }
  }
});

// 30 Hz frames presented at t = 1000 + 33.3 k with clip index k mod 120.
const syntheticFrames = (count, { start = 1000, interval = 1000 / 30, clipFrames = 120 } = {}) =>
  Array.from({ length: count }, (_, k) => ({ t: start + k * interval, timestampMs: start + k * interval - 5, mediaTime: k / 30, index: k % clipFrames }));

test('presentedFrames joins capture events to frame codes by mediaTime', () => {
  const events = [
    { stage: 'capture', start: 20, timestampMs: 15, mediaTime: 0.5 },
    { stage: 'capture', start: 10, timestampMs: 5, mediaTime: 0.46 },
    { stage: 'capture', start: 30, timestampMs: 25, mediaTime: 0.53 },
    { stage: 'render', start: 11 },
  ];
  const codes = [{ mediaTime: 0.46, code: 7 }, { mediaTime: 0.5, code: 8 }];
  assert.deepEqual(presentedFrames(events, codes), [
    { t: 10, timestampMs: 5, mediaTime: 0.46, index: 7 },
    { t: 20, timestampMs: 15, mediaTime: 0.5, index: 8 },
  ]);
});

test('mediaTimeMismatchShare counts frames off the most common offset', () => {
  const frames = syntheticFrames(10).map((f) => ({ ...f, index: (f.index + 3) % 120 }));
  close(mediaTimeMismatchShare(frames, 30, 120), 0);
  frames[4] = { ...frames[4], mediaTime: frames[4].mediaTime + 0.6 / 30 };
  close(mediaTimeMismatchShare(frames, 30, 120), 0.1);
});

test('frameAt returns the frame on screen and presentationRate the frame rate across a loop', () => {
  const frames = syntheticFrames(300);
  assert.equal(frameAt(frames, 999), null);
  assert.equal(frameAt(frames, 1000).index, 0);
  assert.equal(frameAt(frames, 1050).index, 1);
  close(presentationRate(frames, 120), 30, 1e-9);
});

test('offsetError removes the constant offset', () => {
  const samples = [0, 1, 2, 3].map((k) => ({ t: k, truth: k * 10, value: k * 10 + 5 + (k === 3 ? 2 : 0) }));
  const { offset, max } = offsetError(samples);
  close(offset, 5);
  close(max, 2);
});

test('stepResponses times a delayed first-order response and its overshoot', () => {
  const { motion } = MOTION.find((m) => m.id === 'step-x');
  const frames = syntheticFrames(240);
  const truth = (index) => motionTruth(motion, index);
  // Renders at 60 Hz move halfway to the truth of the frame shown 50 ms
  // earlier, from an offset of 7 px.
  const samples = [];
  let value = 7;
  for (let t = 1000; t < frames.at(-1).t; t += 1000 / 60) {
    const target = 7 + truth((frameAt(frames, t - 50) ?? frames[0]).index);
    value += 0.5 * (target - value);
    samples.push({ t, value });
  }
  const responses = stepResponses(samples, frames, truth);
  assert.ok(responses.length >= 6);
  for (const r of responses) {
    // 90% takes four halvings, starting with the first render 50 ms after the step.
    assert.ok(r.lagMs >= 50 + 3 * (1000 / 60) - 1e-6 && r.lagMs < 50 + 4 * (1000 / 60) + 1e-6, String(r.lagMs));
    close(r.overshootPercent, 0, 1e-9);
  }
  const overshooting = samples.map((s, i) => ({ ...s, value: s.value + (i % 60 === 40 ? 0.2 * 80 : 0) }));
  assert.ok(stepResponses(overshooting, frames, truth).some((r) => r.overshootPercent > 10));
});

test('fundamentalDelayMs recovers a known delay of a sinusoid and of a triangle wave', () => {
  const frames = syntheticFrames(480);
  for (const id of ['sine-roll', 'ramp-x']) {
    const { motion } = MOTION.find((m) => m.id === id);
    const truth = (index) => motionTruth(motion, index);
    // A value that shows the frame that was on screen 40 ms earlier.
    const samples = [];
    for (let t = 1100; t < frames.at(-1).t; t += 1000 / 60) {
      const shown = frameAt(frames, t);
      const delayed = frameAt(frames, t - 40);
      samples.push({ t, index: shown.index, truth: truth(shown.index), value: 3 + truth(delayed.index) });
    }
    const delay = fundamentalDelayMs(samples, 30 / motionPeriodFrames(motion));
    assert.ok(Math.abs(delay - 40) < 3, `${id}: ${delay}`);
  }
});

test('triangleLagMs recovers a constant lag whatever the offset', () => {
  const { motion } = MOTION.find((m) => m.id === 'ramp-x');
  const frames = syntheticFrames(480);
  // Continuous triangle wave in time, the value 60 ms behind and 12 px off.
  const at = (t) => {
    const n = (t - 1000) / (1000 / 30);
    const h = motion.halfPeriodFrames;
    const m = ((n % (2 * h)) + 2 * h) % (2 * h);
    return -motion.amplitude + ((2 * motion.amplitude) / h) * (h - Math.abs(h - m));
  };
  const samples = [];
  for (let t = 1000; t < frames.at(-1).t; t += 1000 / 60) {
    const frame = frameAt(frames, t);
    samples.push({ t, index: frame.index, truth: at(t), value: at(t - 60) + 12 });
  }
  close(triangleLagMs(samples, frames, motion, 30), 60, 1e-6);
});

test('renderedSamples and frameSamples pair values with the truth they should match', () => {
  const { motion } = MOTION.find((m) => m.id === 'step-x');
  const frames = syntheticFrames(90);
  const truth = (index) => motionTruth(motion, index);
  const events = [
    { stage: 'renderedPose', t: frames[30].t + 5, value: 1 },
    { stage: 'renderedPose', t: 500, value: 2 },
    { stage: 'glassesPose', gated: false, frameTimestampMs: frames[31].timestampMs, value: 3 },
    { stage: 'glassesPose', gated: true, frameTimestampMs: frames[32].timestampMs, value: 4 },
  ];
  assert.deepEqual(renderedSamples(events, frames, truth, (e) => e.value), [{ t: frames[30].t + 5, index: 30, truth: 80, value: 1 }]);
  assert.deepEqual(frameSamples(events, frames, truth, (e) => e.value), [{ t: frames[31].t, index: 31, truth: 80, value: 3 }]);
});

test('motionMetrics reports step lag for the step clip and delays for the others', () => {
  const frames = syntheticFrames(240);
  for (const condition of MOTION) {
    const truth = (index) => motionTruth(condition.motion, index);
    const samples = frames.map((f) => ({ t: f.t, index: f.index, truth: truth(f.index), value: truth(f.index) }));
    const metrics = motionMetrics(samples, frames, condition, 30, truth);
    close(metrics.error.rms, 0);
    if (condition.motion.kind === 'step') {
      assert.equal(metrics.stepLagMs.median, 0);
      assert.equal(metrics.stepLagMs.missed, 0);
    } else {
      close(metrics.delayMs, 0, 1e-6);
    }
  }
});
