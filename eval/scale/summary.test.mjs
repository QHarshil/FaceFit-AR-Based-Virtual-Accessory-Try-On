import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateIntrinsics } from '../../packages/cv/src/index.ts';
import { seededRandom } from '../../packages/cv/test/random.ts';
import { AVERAGE_SUBJECT, renderSyntheticFace } from '../../packages/cv/test/syntheticFace.ts';
import { clipRecord, measureClip, medianChangePercent, relativeInterval } from './summary.mjs';

const WIDTH = 1280;
const HEIGHT = 720;
const camera = estimateIntrinsics({ width: WIDTH, height: HEIGHT, horizontalFovDeg: 60 });
const subject = { ...AVERAGE_SUBJECT, faceScale: 1.03, distancePdMm: 62 };
const pose = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [10, 0, 550] };

/** A clip of normalized landmarks as clipLandmarks caches them, from a synthetic face. */
function syntheticClip(frames, sigmaPx = 0.4) {
  const random = seededRandom(42);
  let truth;
  const faces = Array.from({ length: frames }, (_, k) => {
    if (k === 3) return null;
    const rendered = renderSyntheticFace(subject, pose, camera, sigmaPx, random);
    truth = rendered.truth;
    return rendered.landmarksPx.map(([x, y]) => [x / WIDTH, y / HEIGHT]);
  });
  return { faces, truth };
}

function numbersIn(value, out = []) {
  if (typeof value === 'number') out.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach((child) => numbersIn(child, out));
  return out;
}

describe('measureClip', () => {
  it('measures a synthetic clip from normalized landmarks and counts the missing face', () => {
    const { faces, truth } = syntheticClip(40);
    const summary = measureClip(faces, WIDTH, HEIGHT, 60);
    assert.ok(summary.ok);
    assert.equal(summary.acceptedFrames, 39);
    assert.equal(summary.rejectedFrames['no-face'], 1);
    // 39 frames at about 1.7% per-frame SD: 4 standard errors of the median is 1.4%.
    assert.ok(Math.abs(summary.nearPupillaryDistance.medianMm / truth.nearPdMm - 1) < 0.014);
    assert.ok(Math.abs(summary.faceWidth.medianMm / truth.faceWidthMm - 1) < 0.014);
  });
});

describe('clipRecord', () => {
  it('records no value in millimetres', () => {
    const { faces } = syntheticClip(30);
    const summary = measureClip(faces, WIDTH, HEIGHT, 60);
    const record = clipRecord(summary, faces.length);
    const absolutes = ['nearPupillaryDistance', 'distancePupillaryDistance', 'faceWidth'].flatMap((key) => {
      const interval = summary[key];
      return [interval.medianMm, interval.lowerMm, interval.upperMm, interval.frameSdMm, interval.noiseSdMm, interval.populationSdMm, interval.modelSdMm];
    });
    absolutes.push(summary.faceScale.median, summary.faceScale.frameSd);
    const recorded = numbersIn(record);
    for (const absolute of absolutes.filter((value) => value > 1e-3)) {
      assert.ok(!recorded.some((value) => Math.abs(value - absolute) < 1e-3), `recorded ${absolute}`);
    }
    // Every recorded number is a count, or a percentage or effective frame count below 100.
    for (const value of recorded) assert.ok(Number.isFinite(value) && value >= 0 && (Number.isInteger(value) || value < 100), `${value}`);
  });

  it('keeps the reason and counts of a failed aggregate', () => {
    const failed = { ok: false, reason: 'too-few-frames', acceptedFrames: 2, rejectedFrames: { 'no-face': 5 } };
    assert.deepEqual(clipRecord(failed, 7), { ok: false, reason: 'too-few-frames', frames: 7, acceptedFrames: 2, rejectedFrames: { 'no-face': 5 } });
  });
});

describe('relativeInterval and medianChangePercent', () => {
  const interval = (medianMm) => ({
    medianMm,
    lowerMm: medianMm * 0.9,
    upperMm: medianMm * 1.1,
    frameSdMm: medianMm * 0.02,
    noiseSdMm: medianMm * 0.004,
    populationSdMm: medianMm * 0.0427,
    modelSdMm: 0,
    effectiveFrames: 12.34,
  });

  it('expresses an interval as percentages of its median', () => {
    assert.deepEqual(relativeInterval(interval(60)), {
      frameSdPercent: 2,
      halfWidthPercent: 10,
      noiseSdPercent: 0.4,
      populationSdPercent: 4.27,
      modelSdPercent: 0,
      effectiveFrames: 12.3,
    });
  });

  it('gives the relative change between two summaries', () => {
    const summary = (scale) => ({
      ok: true,
      nearPupillaryDistance: interval(60 * scale),
      distancePupillaryDistance: interval(61 * scale),
      faceWidth: interval(140 * scale),
    });
    assert.deepEqual(medianChangePercent(summary(1), summary(1.01)), { nearPupillaryDistance: 1, distancePupillaryDistance: 1, faceWidth: 1 });
    assert.equal(medianChangePercent({ ok: false }, summary(1)), null);
  });
});
