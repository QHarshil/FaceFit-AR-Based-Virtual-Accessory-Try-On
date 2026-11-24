import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matrixFromQuaternion, oneEuroPose, quaternionFromMatrix, rotationMatrixFromVector } from '../../packages/cv/src/index.ts';
import { seededRandom } from '../../packages/cv/test/random.ts';
import { renderPlot } from './plotPoseFilter.mjs';
import { operatingPoint, paretoFront, recommend, solvedPoseNoise } from './poseFilterSweep.mjs';
import { pageProjection, replayRun } from './poseReplay.mjs';

const close = (actual, expected, tol = 1e-9) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);

const point = (lag, jitter) => ({ lag, jitter });
const lagOf = (p) => p.lag;
const jitterOf = (p) => p.jitter;

test('paretoFront keeps the points no other beats on both lag and jitter', () => {
  const points = [point(10, 3), point(20, 2), point(25, 2.5), point(30, 1), point(40, 1.2), point(50, 0.5), point(null, 0.1)];
  assert.deepEqual(paretoFront(points, lagOf, jitterOf), [point(10, 3), point(20, 2), point(30, 1), point(50, 0.5)]);
});

test('operatingPoint takes the least jitter under the lag target, else the least lag', () => {
  const points = [point(10, 3), point(45, 1.5), point(49, 1.2), point(60, 0.5)];
  assert.deepEqual(operatingPoint(points, jitterOf, lagOf, 50), point(49, 1.2));
  assert.deepEqual(operatingPoint(points, jitterOf, lagOf, 5), point(10, 3));
});

test('recommend prefers operating points with both lags under the target', () => {
  const metrics = (positionPx, rotationDeg, stepLagMs, sineDelayMs) => ({ metrics: { recStatic: { positionPx, rotationDeg }, stepLagMs, rampDelayMs: stepLagMs, sineDelayMs } });
  const configurations = [
    { numFaces: 1, oneEuro: { chosen: metrics(0.9, 0.15, 35, 45) }, kalman: { chosen: metrics(0.4, 0.05, 80, 30) } },
    { numFaces: 2, oneEuro: { chosen: metrics(1.0, 0.12, 35, 40) }, kalman: { chosen: metrics(1.4, 0.11, 35, 30) } },
  ];
  const best = recommend(configurations);
  assert.equal(best.filter, 'oneEuro');
  assert.equal(best.numFaces, 1);
  assert.equal(best.lagsUnderTarget, true);
  close(best.worstJitterRatio, 1.8);
});

// A run as baseline.mjs records it: frames presented every 33 ms, each solved
// 15 ms later, and renders every 16.7 ms. The face moves 2 mm per frame.
const syntheticRun = (count) => {
  const events = [];
  const anchors = [[0, -32.7, -55.4], [-60, -35, -45], [60, -35, -45]];
  const sample = (k, extra = {}) => {
    const rotation = rotationMatrixFromVector([0, 0.01 * k, 0]);
    const q = quaternionFromMatrix(rotation);
    return {
      stage: 'glassesPose', t: k * 33.3 + 15, frameTimestampMs: k * 33.3, gated: false, focalPx: 1000, principalPx: [640, 360], frameSize: [1280, 720],
      headPose: { quaternion: [q.x, q.y, q.z, q.w], translationMm: [2 * k, 0, 600] }, anchorsFaceMm: anchors, ...extra,
    };
  };
  for (let k = 0; k < count; k += 1) {
    events.push({ stage: 'capture', start: k * 33.3 + 1, timestampMs: k * 33.3 });
    events.push({ stage: 'renderedPose', t: k * 33.3 + 2 });
    events.push(k === 20 ? sample(k, { gated: true, gateReason: 'no-face', headPose: null }) : sample(k));
    events.push({ stage: 'renderedPose', t: k * 33.3 + 18 });
  }
  return { events, environment: { video: [1280, 720], viewport: [1280, 720] } };
};

test('pageProjection is the pinhole through the cover fit', () => {
  const project = pageProjection({ focalPx: 1000, principalPx: [640, 360], frameSize: [1280, 720] }, [1280, 720], [640, 640]);
  const identity = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [0, 0, 500] };
  // 16:9 video in a square page: scale 640 / 720, centred with the sides cropped.
  const [x, y] = project(identity, [50, 25, 0]);
  const scale = 640 / 720;
  close(x, (640 + 100) * scale + (640 - 1280 * scale) / 2);
  close(y, (360 + 50) * scale);
});

test('replayRun without a filter draws each solved pose until the next one', () => {
  const run = syntheticRun(10);
  const { renders, frames } = replayRun(run, () => null);
  assert.equal(frames.length, 10);
  // The first render of frame 0 comes before any pose.
  assert.equal(renders.length, 19);
  assert.deepEqual(renders[0].centerPx, frames[0].centerPx);
  assert.deepEqual(renders[1].centerPx, frames[0].centerPx);
  assert.deepEqual(renders[2].centerPx, frames[1].centerPx);
});

test('replayRun predicts each render to the newest presented frame and resets on a lost face', () => {
  const run = syntheticRun(30);
  const params = { rotation: { minCutoffHz: 1, beta: 0.1, derivativeCutoffHz: 1 }, translation: { minCutoffHz: 1, beta: 0.01, derivativeCutoffHz: 1 } };
  const { renders, frames } = replayRun(run, () => oneEuroPose(params));
  // Reference: the same filter driven by hand.
  const reference = oneEuroPose(params);
  const poses = run.events.filter((e) => e.stage === 'glassesPose');
  const project = pageProjection(poses[0], [1280, 720], [1280, 720]);
  const bridge = poses[0].anchorsFaceMm[0];
  const solvedPose = (e) => {
    const [x, y, z, w] = e.headPose.quaternion;
    return { rotation: matrixFromQuaternion({ w, x, y, z }), translationMm: e.headPose.translationMm };
  };
  let renderIndex = 0;
  let latest = null;
  let presented = -Infinity;
  for (const e of run.events) {
    if (e.stage === 'capture') presented = e.timestampMs;
    if (e.stage === 'glassesPose' && e.gated) {
      reference.reset();
      latest = null;
    } else if (e.stage === 'glassesPose') {
      reference.update(solvedPose(e), e.frameTimestampMs);
      latest = e.frameTimestampMs;
    } else if (e.stage === 'renderedPose' && latest !== null) {
      const expected = project(reference.predict(Math.max(presented, latest)), bridge);
      close(renders[renderIndex].centerPx[0], expected[0], 1e-9);
      close(renders[renderIndex].centerPx[1], expected[1], 1e-9);
      renderIndex += 1;
    }
  }
  assert.equal(renderIndex, renders.length);
  assert.equal(frames.length, 29);
  // The first pose after the lost face is drawn as solved: frames skip the gated sample.
  assert.deepEqual(frames[20].centerPx, project(solvedPose(poses[21]), bridge));
});

test('replayRun runs the warmup first and keeps only the measured output', () => {
  const run = syntheticRun(20);
  const split = run.events.findIndex((e) => e.stage === 'capture' && e.timestampMs > 300);
  const warm = replayRun({ ...run, warmupEvents: run.events.slice(0, split), events: run.events.slice(split) }, () => null);
  const cold = replayRun(run, () => null);
  assert.equal(warm.renders.length, cold.renders.filter((r) => r.t >= run.events[split].start).length);
  assert.deepEqual(warm.renders.at(-1), cold.renders.at(-1));
});

test('solvedPoseNoise recovers white translation and rotation noise of a known size', () => {
  const random = seededRandom(31);
  const sigma = [0.8, 0.3, 2];
  const sigmaRad = 0.003;
  const events = Array.from({ length: 3000 }, (_, k) => {
    const rotation = rotationMatrixFromVector([random.gaussian(sigmaRad), random.gaussian(sigmaRad), random.gaussian(sigmaRad)]);
    const q = quaternionFromMatrix(rotation);
    const landmarks = Array.from({ length: 13 }, (_, i) => [0.4 + 0.01 * i, 0.5 + (i % 3) * 0.01, 0]);
    return {
      stage: 'glassesPose', t: k * 33.3, gated: false,
      headPose: { quaternion: [q.x, q.y, q.z, q.w], translationMm: sigma.map((s, i) => [0, 0, 600][i] + random.gaussian(s)) },
      landmarks, targetNdc: [0, 0], smoothedNdc: [0, 0], smoothedEndsNdc: [[-0.1, 0], [0.1, 0]], euler: [0, 0, 0],
    };
  });
  const noise = solvedPoseNoise({ events, environment: { video: [1280, 720], viewport: [1280, 720] } });
  noise.translationMm.forEach((estimate, i) => close(estimate / sigma[i], 1, 0.06));
  close(noise.rotationRad / sigmaRad, 1, 0.06);
});

test('renderPlot draws one curve per filter and configuration, the unfiltered points and the targets', () => {
  const metrics = (positionPx, rotationDeg, lagMs) => ({ metrics: { recStatic: { positionPx, rotationDeg }, stepLagMs: lagMs, rampDelayMs: lagMs - 5, sineDelayMs: lagMs } });
  const stage = () => ({ front: [{ lagMs: 20, jitter: 1.2 }, { lagMs: 40, jitter: 0.8 }, { lagMs: 400, jitter: 0.5 }], chosen: metrics(0.8, 0.15, 40) });
  const configuration = (numFaces) => ({ numFaces, label: `off-${numFaces}`, unfiltered: metrics(1.4, 0.24, 17).metrics, oneEuro: { rotation: stage(), translation: stage() }, kalman: { rotation: stage(), translation: stage() } });
  const svg = renderPlot({ commit: 'abcdef1234', targets: { positionJitterPx: 0.5, rotationJitterDeg: 0.1, lagMs: 50 }, recommended: { filter: 'oneEuro', numFaces: 1 }, configurations: [configuration(1), configuration(2)] });
  assert.ok(svg.startsWith('<svg'));
  // Two panels with four curves each; the 400 ms point is past the axis and dropped.
  assert.equal((svg.match(/<path /g) ?? []).length, 8);
  assert.equal((svg.match(/stroke-dasharray="6 4"/g) ?? []).length, 2 * 2 + 2);
  assert.equal((svg.match(/>none, [12]</g) ?? []).length, 4);
  assert.equal((svg.match(/>chosen</g) ?? []).length, 2);
  assert.ok(svg.includes('>target<'));
});
