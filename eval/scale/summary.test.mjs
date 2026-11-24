import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateIntrinsics } from '../../packages/cv/src/index.ts';
import { seededRandom } from '../../packages/cv/test/random.ts';
import { AVERAGE_SUBJECT, renderSyntheticFace } from '../../packages/cv/test/syntheticFace.ts';
import { clipRecord, landmarkDiagnostics, measureClip, medianChangePercent } from './summary.mjs';

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
    assert.equal(summary.rejectedFrames['no-face'], 1);
    // The asymmetry gate sits at 3 MAD-based SDs of the ratio here; this seed has one clean frame just past it.
    assert.ok(summary.rejectedFrames['asymmetric-iris'] <= 1);
    assert.equal(summary.acceptedFrames + summary.rejectedFrames['asymmetric-iris'], 39);
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
    // Every recorded number is a count or a percentage below 100; half-widths are whole percent.
    for (const value of recorded) assert.ok(Number.isFinite(value) && value >= 0 && (Number.isInteger(value) || value < 100), `${value}`);
    for (const key of ['nearPupillaryDistance', 'distancePupillaryDistance', 'faceWidth']) assert.ok(Number.isInteger(record[key].halfWidthPercent));
  });

  it('keeps the reason and counts of a failed aggregate', () => {
    const failed = { ok: false, reason: 'too-few-frames', acceptedFrames: 2, rejectedFrames: { 'no-face': 5 } };
    assert.deepEqual(clipRecord(failed, 7), { ok: false, reason: 'too-few-frames', frames: 7, acceptedFrames: 2, rejectedFrames: { 'no-face': 5 } });
  });
});

describe('medianChangePercent', () => {
  const interval = (medianMm) => ({ medianMm, lowerMm: medianMm * 0.9, upperMm: medianMm * 1.1 });

  it('gives the relative change of near PD and face width between two summaries, and nothing for distance PD', () => {
    const summary = (scale) => ({
      ok: true,
      nearPupillaryDistance: interval(60 * scale),
      distancePupillaryDistance: interval(61 * scale),
      faceWidth: interval(140 * scale),
    });
    assert.deepEqual(medianChangePercent(summary(1), summary(1.01)), { nearPupillaryDistance: 1, faceWidth: 1 });
    assert.equal(medianChangePercent({ ok: false }, summary(1)), null);
  });
});

describe('landmarkDiagnostics', () => {
  it('reads the rendered iris aspect and the narrowing of a shrunken iris', () => {
    const random = seededRandom(43);
    const faces = Array.from({ length: 40 }, (_, k) => {
      const closing = k % 10 === 0;
      const rendered = renderSyntheticFace(subject, pose, camera, 0, random, closing ? { eyeOpenness: 0.1, irisShrink: 0.15 } : {});
      return rendered.landmarksPx.map(([x, y]) => [x / WIDTH, y / HEIGHT]);
    });
    const diagnostics = landmarkDiagnostics(faces, WIDTH, HEIGHT);
    assert.ok(Math.abs(diagnostics.irisVerticalOverHorizontal - subject.irisAspect) < 0.01);
    assert.equal(diagnostics.openFrameOpennessSdPercent, 0);
    const closed = diagnostics.irisWidthByRelativeOpenness[0];
    assert.equal(closed.frames, 4);
    assert.ok(Math.abs(closed.irisWidthChangePercent + 15) < 0.5);
    assert.equal(diagnostics.irisWidthByRelativeOpenness[3].irisWidthChangePercent, 0);
  });
});
