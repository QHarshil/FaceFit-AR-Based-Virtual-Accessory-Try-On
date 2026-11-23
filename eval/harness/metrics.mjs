// Pure metric functions over probe events. Screen quantities are in CSS pixels
// of the unmirrored page; the video and the WebGL canvas share one CSS mirror,
// so comparing them unmirrored is equivalent.

export const LANDMARK = { noseTip: 1, rightEyeOuter: 33, rightEyeInner: 133, rightLower: 145, rightUpper: 159,
  noseBridge: 168, rightContour: 234, leftEyeOuter: 263, leftEyeInner: 362, leftLower: 374, leftUpper: 386,
  leftContour: 454 };

// Order of the landmark subset the app probe emits (PROBE_LANDMARKS in ARTryOn.js).
export const PROBE_ORDER = [1, 10, 33, 133, 145, 159, 168, 234, 263, 362, 374, 386, 454];
const slot = (index) => PROBE_ORDER.indexOf(index);

const DEG = 180 / Math.PI;

export const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
};

export const median = (values) => percentile(values, 50);

export const summarize = (values) => ({
  n: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
});

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const ndcToPx = ([x, y], [vw, vh]) => [((x + 1) / 2) * vw, ((1 - y) / 2) * vh];

// Normalized landmark to page pixels under `object-fit: cover`.
export const landmarkToPx = ([x, y], [videoW, videoH], [vw, vh]) => {
  const scale = Math.max(vw / videoW, vh / videoH);
  return [x * videoW * scale + (vw - videoW * scale) / 2, y * videoH * scale + (vh - videoH * scale) / 2];
};

// Least-squares slope and intercept of y on x.
export const linearFit = (xs, ys) => {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
};

// Angle of the line a->b on screen, degrees, clockwise positive (y points down).
export const lineAngle = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * DEG;

// Wrap to (-90, 90] so a line and its reverse compare equal.
export const wrapLineAngle = (deg) => {
  let a = ((deg % 180) + 180) % 180;
  if (a > 90) a -= 180;
  return a;
};

// Centered moving average over `window` samples, truncated at the ends.
const movingAverage = (points, window) => {
  const half = Math.floor(window / 2);
  return points.map((_, i) => {
    const span = points.slice(Math.max(0, i - half), i + half + 1);
    return [span.reduce((s, p) => s + p[0], 0) / span.length, span.reduce((s, p) => s + p[1], 0) / span.length];
  });
};

// Spread of 2D points: RMS distance from their mean (includes slow drift), RMS
// distance from a centered moving average (jitter without drift), and RMS step
// between consecutive points.
export const pointJitter = (points, window = 9) => {
  const n = points.length;
  const mean = [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  const spread = Math.sqrt(points.reduce((s, p) => s + distance(p, mean) ** 2, 0) / n);
  const trend = movingAverage(points, window);
  const highPass = Math.sqrt(points.reduce((s, p, i) => s + distance(p, trend[i]) ** 2, 0) / n);
  let step = 0;
  for (let i = 1; i < n; i += 1) step += distance(points[i], points[i - 1]) ** 2;
  return { rmsFromMean: spread, rmsHighPass: highPass, rmsStep: n > 1 ? Math.sqrt(step / (n - 1)) : 0 };
};

const quatDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const quatAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(quatDot(a, b)))) * DEG;

// Sign-aligned normalized mean of unit quaternions (valid for small spreads).
const quatMean = (quats) => {
  const ref = quats[0];
  const sum = [0, 0, 0, 0];
  for (const q of quats) {
    const s = quatDot(q, ref) < 0 ? -1 : 1;
    for (let i = 0; i < 4; i += 1) sum[i] += s * q[i];
  }
  const norm = Math.hypot(...sum);
  return sum.map((v) => v / norm);
};

// Spread of rotations in degrees: RMS angle from the mean, from a centered
// moving mean (jitter without drift), and between consecutive rotations.
export const rotationJitter = (quats, window = 9) => {
  const n = quats.length;
  const half = Math.floor(window / 2);
  const mean = quatMean(quats);
  const fromMean = Math.sqrt(quats.reduce((s, q) => s + quatAngle(q, mean) ** 2, 0) / n);
  const highPass = Math.sqrt(quats.reduce((s, q, i) => s + quatAngle(q, quatMean(quats.slice(Math.max(0, i - half), i + half + 1))) ** 2, 0) / n);
  let step = 0;
  for (let i = 1; i < n; i += 1) step += quatAngle(quats[i], quats[i - 1]) ** 2;
  return { rmsFromMean: fromMean, rmsHighPass: highPass, rmsStep: n > 1 ? Math.sqrt(step / (n - 1)) : 0 };
};

// Per-stage timings and the pipeline latency from frame pickup to the end of
// the first render that includes the new pose.
export const latency = (events) => {
  const of = (stage) => events.filter((e) => e.stage === stage);
  const sends = of('send');
  const poses = of('pose');
  const renders = of('render');
  const durations = (list) => list.map((e) => e.end - e.start);
  const intervals = (list) => list.slice(1).map((e, i) => e.start - list[i].start);

  const pipeline = [];
  let r = 0;
  for (const send of sends) {
    const pose = poses.find((p) => p.start >= send.start && p.end <= send.end);
    if (!pose) continue;
    while (r < renders.length && renders[r].start < pose.end) r += 1;
    if (r < renders.length) pipeline.push(renders[r].end - send.start);
  }
  return {
    inferenceMs: summarize(durations(sends)),
    poseMs: summarize(durations(poses)),
    renderCpuMs: summarize(durations(renders)),
    inferenceIntervalMs: summarize(intervals(sends)),
    renderIntervalMs: summarize(intervals(renders)),
    pipelineMs: summarize(pipeline),
  };
};

// Screen-space geometry of one glassesPose sample.
export const sampleGeometry = (sample, video, viewport) => {
  const lm = (index) => landmarkToPx(sample.landmarks[slot(index)], video, viewport);
  const ends = sample.smoothedEndsNdc.map((p) => ndcToPx(p, viewport));
  const rightOuter = lm(LANDMARK.rightEyeOuter);
  const leftOuter = lm(LANDMARK.leftEyeOuter);
  return {
    targetCenter: ndcToPx(sample.targetNdc, viewport),
    renderedCenter: ndcToPx(sample.smoothedNdc, viewport),
    renderedWidth: distance(ends[0], ends[1]),
    renderedAngle: lineAngle(ends[0], ends[1]),
    noseBridge: lm(LANDMARK.noseBridge),
    faceAngle: lineAngle(rightOuter, leftOuter),
    faceWidth: distance(lm(LANDMARK.rightContour), lm(LANDMARK.leftContour)),
    interocular: distance(rightOuter, leftOuter),
    eyeOpenness: eyeOpenness(sample.landmarks),
    currentAnchorY: currentAnchorY(sample.landmarks, video, viewport),
    cornerAnchorY: meanY([LANDMARK.rightEyeOuter, LANDMARK.rightEyeInner, LANDMARK.leftEyeOuter, LANDMARK.leftEyeInner].map(lm)),
    euler: sample.euler.map((v) => v * DEG),
  };
};

const meanY = (points) => points.reduce((s, p) => s + p[1], 0) / points.length;

// Vertical anchor of the current glasses heuristic (ARTryOn.js updateGlasses),
// in page pixels: the mean of eye corners and eyelids, pulled 18% toward the
// nose bridge, blended 70/30 with the nose tip.
export const currentAnchorY = (landmarks, video, viewport) => {
  const y = (index) => landmarks[slot(index)][1];
  const eyes = [LANDMARK.rightEyeOuter, LANDMARK.rightEyeInner, LANDMARK.rightUpper, LANDMARK.rightLower,
    LANDMARK.leftEyeInner, LANDMARK.leftEyeOuter, LANDMARK.leftUpper, LANDMARK.leftLower];
  const eyeMid = eyes.reduce((s, i) => s + y(i), 0) / eyes.length;
  const anchor = eyeMid + (y(LANDMARK.noseBridge) - eyeMid) * 0.18;
  const blended = anchor * 0.7 + y(LANDMARK.noseTip) * 0.3;
  return landmarkToPx([0.5, blended], video, viewport)[1];
};

// Mean eyelid gap over eye width for both eyes, from normalized landmarks.
// The aspect distortion of normalized coordinates cancels in the blink ratio.
export const eyeOpenness = (landmarks) => {
  const at = (index) => landmarks[slot(index)];
  const ratio = (upper, lower, outer, inner) => distance(at(upper), at(lower)) / distance(at(outer), at(inner));
  return (ratio(LANDMARK.rightUpper, LANDMARK.rightLower, LANDMARK.rightEyeOuter, LANDMARK.rightEyeInner)
    + ratio(LANDMARK.leftUpper, LANDMARK.leftLower, LANDMARK.leftEyeOuter, LANDMARK.leftEyeInner)) / 2;
};

// Indices outside every blink widened by `margin` samples.
export const outsideBlinks = (count, blinks, margin = 10) =>
  [...Array(count).keys()].filter((i) => blinks.every(([a, b]) => i < a - margin || i > b + margin));

// Runs of samples whose eye openness falls below `threshold` times the median.
export const findBlinks = (openness, threshold = 0.6) => {
  const cutoff = median(openness) * threshold;
  const blinks = [];
  let start = -1;
  openness.forEach((value, i) => {
    if (value < cutoff && start < 0) start = i;
    if (value >= cutoff && start >= 0) {
      blinks.push([start, i - 1]);
      start = -1;
    }
  });
  if (start >= 0) blinks.push([start, openness.length - 1]);
  return blinks;
};

// Peak vertical displacement of a point series during each blink, against the
// median of the open-eye samples just before it. `settle` extends the window
// so smoothing lag is counted.
export const blinkShift = (ys, blinks, { before = 10, settle = 6 } = {}) =>
  blinks
    .filter(([start]) => start >= before)
    .map(([start, end]) => {
      const baseline = median(ys.slice(start - before, start));
      const window = ys.slice(start, Math.min(ys.length, end + settle + 1));
      return Math.max(...window.map((y) => Math.abs(y - baseline)));
    });
