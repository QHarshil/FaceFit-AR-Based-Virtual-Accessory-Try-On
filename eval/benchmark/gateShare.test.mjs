import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { estimateIntrinsics } from '../../packages/cv/src/index.ts';
import { seededRandom } from '../../packages/cv/test/random.ts';
import { GATE, gateOutcome, summarizeOutcomes, syntheticOutcome } from './gateShare.mjs';

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 });
// A face 600 mm away whose reprojection RMS in pixels gives `mm` at that depth.
const solveAt = (mm, rotation = [-1, 0, 0, 0, 1, 0, 0, 0, -1]) => ({
  ok: true,
  rotation,
  translationMm: [0, 0, 600],
  rmsReprojectionPx: (mm * intrinsics.fx) / 600,
});

describe('gate constants', () => {
  it('match gateHeadPose and the app FOV', () => {
    const source = readFileSync(new URL('../../frontend/src/geometry/headPose.ts', import.meta.url), 'utf8');
    const constant = (name) => Number(new RegExp(`export const ${name} = ([\\d.]+);`).exec(source)[1]);
    assert.equal(constant('MAX_RMS_REPROJECTION_MM'), GATE.hideAboveMm);
    assert.equal(constant('SHOW_BELOW_RMS_MM'), GATE.showBelowMm);
    assert.equal(constant('DEFAULT_HORIZONTAL_FOV_DEG'), GATE.horizontalFovDeg);
  });
});

describe('gateOutcome', () => {
  it('sorts a solve by the thresholds and the facing check', () => {
    // The model's forward axis is -z, toward the camera at the identity; a
    // half turn about y points it away.
    assert.equal(gateOutcome(solveAt(3), intrinsics).outcome, 'facing-away');
    assert.equal(gateOutcome(solveAt(3, identity), intrinsics).outcome, 'shown');
    assert.equal(gateOutcome(solveAt(5.5, identity), intrinsics).outcome, 'held');
    assert.equal(gateOutcome(solveAt(6.5, identity), intrinsics).outcome, 'hide');
    assert.equal(gateOutcome({ ok: false, reason: 'no-solution' }, intrinsics).outcome, 'failed');
    assert.ok(Math.abs(gateOutcome(solveAt(3, identity), intrinsics).rmsMm - 3) < 1e-12);
  });

  it('summarizes the shares a shown overlay would hide and a hidden one would not show', () => {
    const outcomes = [{ outcome: 'shown', rmsMm: 1 }, { outcome: 'held', rmsMm: 5.5 }, { outcome: 'hide', rmsMm: 7 }, { outcome: 'failed', rmsMm: null }];
    const summary = summarizeOutcomes(outcomes, 1);
    assert.equal(summary.hiddenShare, 0.5);
    assert.equal(summary.notShownShare, 0.75);
    assert.equal(summary.hiddenShareWithNoFace, 0.6);
    assert.equal(summary.images, 5);
  });
});

describe('syntheticOutcome', () => {
  const medianRms = (depthMm, shapeSigmaMm, pixelSigma) => {
    const random = seededRandom(7);
    const rms = Array.from({ length: 200 }, () => syntheticOutcome(random, depthMm, shapeSigmaMm, pixelSigma).rmsMm).sort((a, b) => a - b);
    return rms[100];
  };

  // With fixed pixel noise the residual in millimetres scales with depth over
  // focal length; a shape mismatch alone leaves it the same at any depth.
  it('grows with depth for pixel noise and not for shape mismatch', () => {
    const near = medianRms(500, 0, 1);
    const far = medianRms(2000, 0, 1);
    assert.ok(Math.abs(far / near - 4) < 0.4, `${far / near}`);
    const shapeNear = medianRms(500, 3, 0);
    const shapeFar = medianRms(2000, 3, 0);
    assert.ok(Math.abs(shapeFar / shapeNear - 1) < 0.1, `${shapeFar / shapeNear}`);
  });
});
