// Metrics on the motion clips, whose truth is known per clip frame
// (MOTION in conditions.mjs). Times are main-thread performance.now()
// milliseconds. A sample is { t, value, truth }: what the app showed at time
// t, and the truth of the frame it should match.
import { lineAngle, median, ndcToPx, percentile } from './metrics.mjs';

// Presented camera frames with their clip frame index. The harness reads the
// frame code in its own frame callback, which sees the same mediaTime as the
// app's capture callback for the same frame.
export const presentedFrames = (events, frameCodes) => {
  const indexOf = new Map(frameCodes.map((c) => [c.mediaTime, c.code]));
  return events
    .filter((e) => e.stage === 'capture' && indexOf.has(e.mediaTime))
    .map((e) => ({ t: e.start, timestampMs: e.timestampMs, mediaTime: e.mediaTime, index: indexOf.get(e.mediaTime) }))
    .sort((a, b) => a.t - b.t);
};

// Share of frames whose clip index is not round(mediaTime * fps) plus the
// most common offset, modulo the clip length: how often mediaTime alone
// would pick the wrong truth.
export const mediaTimeMismatchShare = (frames, fps, clipFrames) => {
  if (!frames.length) return null;
  const offsets = frames.map((f) => (((f.index - Math.round(f.mediaTime * fps)) % clipFrames) + clipFrames) % clipFrames);
  const counts = new Map();
  for (const o of offsets) counts.set(o, (counts.get(o) ?? 0) + 1);
  const common = Math.max(...counts.values());
  return 1 - common / frames.length;
};

// The frame on screen at time t: the last one presented at or before t.
export const frameAt = (frames, t) => {
  let lo = 0;
  let hi = frames.length - 1;
  if (hi < 0 || frames[0].t > t) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
};

// Presented frames per second: slope of the unwrapped clip index against time.
export const presentationRate = (frames, clipFrames) => {
  if (frames.length < 2) return null;
  let turns = 0;
  const xs = [];
  const ys = [];
  frames.forEach((f, i) => {
    if (i > 0 && f.index < frames[i - 1].index - clipFrames / 2) turns += 1;
    xs.push(f.t / 1000);
    ys.push(f.index + turns * clipFrames);
  });
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  return sxy / sxx;
};

// Error against truth after removing the constant offset between them (the
// registration offset, measured by the still and translation conditions).
export const offsetError = (samples) => {
  if (!samples.length) return null;
  const offset = median(samples.map((s) => s.value - s.truth));
  const errors = samples.map((s) => Math.abs(s.value - s.truth - offset));
  return {
    offset,
    rms: Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length),
    p95: percentile(errors, 95),
    max: Math.max(...errors),
  };
};

// Each step in the truth: the time from the first frame showing it to the
// first sample at `fraction` of the way to the new level, and the overshoot
// past the new level in percent of the step. The old level is the median of
// the samples in the `baselineMs` before the step, so a constant offset does
// not count.
export const stepResponses = (samples, frames, truthOfIndex, { fraction = 0.9, baselineMs = 300 } = {}) => {
  const changes = [];
  for (let j = 1; j < frames.length; j += 1) {
    const from = truthOfIndex(frames[j - 1].index);
    const to = truthOfIndex(frames[j].index);
    if (from !== to) changes.push({ t: frames[j].t, step: to - from });
  }
  return changes.flatMap(({ t, step }, k) => {
    const end = changes[k + 1]?.t ?? Number.POSITIVE_INFINITY;
    const before = samples.filter((s) => s.t >= t - baselineMs && s.t < t).map((s) => s.value);
    const after = samples.filter((s) => s.t >= t && s.t < end);
    if (!before.length || !after.length) return [];
    const baseline = median(before);
    const progress = after.map((s) => (s.value - baseline) / step);
    const reached = progress.findIndex((p) => p >= fraction);
    return [{
      step,
      lagMs: reached < 0 ? null : after[reached].t - t,
      overshootPercent: Math.max(0, Math.max(...progress) - 1) * 100,
    }];
  });
};

// Least-squares fit of c + a sin(wt) + b cos(wt) by Gauss-Jordan elimination
// on the 3 x 3 normal equations; returns the phase atan2(b, a).
const fundamentalPhase = (ts, ys, omega) => {
  const rows = ts.map((t) => [1, Math.sin(omega * t), Math.cos(omega * t)]);
  const m = [0, 1, 2].map((i) => [
    ...[0, 1, 2].map((j) => rows.reduce((s, r) => s + r[i] * r[j], 0)),
    rows.reduce((s, r, k) => s + r[i] * ys[k], 0),
  ]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < 3; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < 3; r += 1) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 4; c += 1) m[r][c] -= f * m[col][c];
    }
  }
  return Math.atan2(m[2][3] / m[2][2], m[1][3] / m[1][1]);
};

// Delay of the samples behind their truth at the clip's fundamental
// frequency: the phase difference of the fitted fundamentals over the
// angular frequency. Both are sampled at the same times, so the truth's own
// staircase cancels. For a pure delay this is where the cross-correlation
// peaks.
export const fundamentalDelayMs = (samples, frequencyHz) => {
  if (samples.length < 4 || !(frequencyHz > 0)) return null;
  const omega = 2 * Math.PI * frequencyHz;
  const ts = samples.map((s) => s.t / 1000);
  const truthPhase = fundamentalPhase(ts, samples.map((s) => s.truth), omega);
  const valuePhase = fundamentalPhase(ts, samples.map((s) => s.value), omega);
  let difference = truthPhase - valuePhase;
  difference -= 2 * Math.PI * Math.round(difference / (2 * Math.PI));
  return (difference / omega) * 1000;
};

// Lag at constant velocity on a triangle wave, in ms. On a rising segment a
// lagging signal sits speed * lag below the truth and on a falling one above
// it, so half the difference of (truth - value) between the two cancels any
// constant offset. Only the second half of each segment counts, after the
// turn's transient.
export const triangleLagMs = (samples, frames, motion, framesPerSecond) => {
  const h = motion.halfPeriodFrames;
  const speedPerSecond = ((2 * motion.amplitude) / h) * framesPerSecond;
  const rising = [];
  const falling = [];
  for (const s of samples) {
    const m = s.index % (2 * h);
    if (m >= h / 2 && m < h) rising.push(s.truth - s.value);
    else if (m >= (3 * h) / 2) falling.push(s.truth - s.value);
  }
  if (!rising.length || !falling.length) return null;
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  return ((mean(rising) - mean(falling)) / (2 * speedPerSecond)) * 1000;
};

// Samples of what the overlay drew at each render against the truth of the
// frame on screen then. `read` turns a renderedPose event into the value.
export const renderedSamples = (events, frames, truthOfIndex, read) =>
  events
    .filter((e) => e.stage === 'renderedPose')
    .flatMap((e) => {
      const frame = frameAt(frames, e.t);
      return frame ? [{ t: e.t, index: frame.index, truth: truthOfIndex(frame.index), value: read(e) }] : [];
    });

// Samples per processed frame against that frame's own truth, timed at the
// frame's presentation. `read` turns a shown glassesPose event into the value.
export const frameSamples = (events, frames, truthOfIndex, read) => {
  const byTimestamp = new Map(frames.map((f) => [f.timestampMs, f]));
  return events
    .filter((e) => e.stage === 'glassesPose' && !e.gated && byTimestamp.has(e.frameTimestampMs))
    .map((e) => {
      const frame = byTimestamp.get(e.frameTimestampMs);
      return { t: frame.t, index: frame.index, truth: truthOfIndex(frame.index), value: read(e) };
    });
};

// Screen readers for the two kinds of motion: the bridge anchor's x in page
// pixels, and the angle of the hinge line in degrees, clockwise on screen.
export const readCenterX = (viewport) => (ndc) => ndcToPx(ndc, viewport)[0];
export const readLineAngle = (viewport) => (ends) => lineAngle(ndcToPx(ends[0], viewport), ndcToPx(ends[1], viewport));

// Every motion metric for one series of samples.
export const motionMetrics = (samples, frames, condition, framesPerSecond, truthOfIndex) => {
  const { motion } = condition;
  const periodFrames = motion.periodFrames ?? 2 * motion.halfPeriodFrames;
  const metrics = { samples: samples.length, error: offsetError(samples) };
  if (motion.kind === 'step') {
    const steps = stepResponses(samples, frames, truthOfIndex);
    const lags = steps.map((s) => s.lagMs).filter((v) => v != null);
    metrics.steps = steps.length;
    metrics.stepLagMs = { median: lags.length ? median(lags) : null, max: lags.length ? Math.max(...lags) : null, missed: steps.length - lags.length };
    metrics.overshootPercent = { median: steps.length ? median(steps.map((s) => s.overshootPercent)) : null, max: steps.length ? Math.max(...steps.map((s) => s.overshootPercent)) : null };
  } else {
    metrics.delayMs = fundamentalDelayMs(samples, framesPerSecond / periodFrames);
    if (motion.kind === 'triangle') metrics.constantVelocityLagMs = triangleLagMs(samples, frames, motion, framesPerSecond);
  }
  return metrics;
};
