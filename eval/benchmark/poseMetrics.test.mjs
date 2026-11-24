import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aflwAngles, aflwRotation } from './conventions.mjs';
import { correlation, percentile, poseErrorsDeg, summarizePoseErrors, withinProtocol, wrapDegrees } from './poseMetrics.mjs';

const DEG = Math.PI / 180;
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);
const anglesDeg = (pitch, yaw, roll) => ({ pitch: pitch * DEG, yaw: yaw * DEG, roll: roll * DEG });

describe('wrapDegrees', () => {
  it('wraps into (-180, 180]', () => {
    assert.equal(wrapDegrees(190), -170);
    assert.equal(wrapDegrees(-190), 170);
    assert.equal(wrapDegrees(180), 180);
    assert.equal(wrapDegrees(-180), 180);
    assert.equal(wrapDegrees(540), 180);
    assert.equal(wrapDegrees(-45), -45);
  });
});

describe('withinProtocol', () => {
  it('keeps labels up to 99 degrees on every axis', () => {
    assert.ok(withinProtocol(anglesDeg(99, -99, 99)));
    assert.ok(!withinProtocol(anglesDeg(0, 99.01, 0)));
    assert.ok(!withinProtocol(anglesDeg(-120, 0, 0)));
    assert.ok(!withinProtocol(anglesDeg(0, 0, 100)));
  });
});

describe('poseErrorsDeg', () => {
  it('is zero for the same pose and the axis offset for a single-axis error', () => {
    const truth = anglesDeg(10, -20, 5);
    const same = poseErrorsDeg(truth, truth);
    for (const key of ['pitch', 'yaw', 'roll', 'geodesic']) close(same[key], 0, 1e-6);
    const off = poseErrorsDeg(anglesDeg(0, 10, 0), anglesDeg(0, 0, 0));
    close(off.yaw, 10);
    close(off.pitch, 0);
    close(off.roll, 0);
    close(off.geodesic, 10);
  });

  it('wraps differences across 180 degrees', () => {
    close(poseErrorsDeg(anglesDeg(0, 0, -179), anglesDeg(0, 0, 179)).roll, 2);
  });

  it('does not charge a label past 90 degrees of yaw for the branch of the decomposition', () => {
    const truth = anglesDeg(5, 95, -3);
    const predicted = aflwAngles(aflwRotation(truth));
    close(predicted.yaw, 85 * DEG);
    const errors = poseErrorsDeg(predicted, truth);
    for (const key of ['pitch', 'yaw', 'roll', 'geodesic']) close(errors[key], 0, 1e-6);
  });
});

describe('percentile', () => {
  it('interpolates between order statistics', () => {
    close(percentile([4, 1, 3, 2], 0.5), 2.5);
    close(percentile([1, 2, 3, 4], 0.9), 3.7);
    assert.equal(percentile([7], 0.9), 7);
    assert.equal(percentile([], 0.5), null);
  });
});

describe('summarizePoseErrors', () => {
  it('computes MAE, geodesic statistics and threshold shares on known errors', () => {
    const summary = summarizePoseErrors([
      { pitch: 1, yaw: 2, roll: 3, geodesic: 4 },
      { pitch: 3, yaw: 4, roll: 5, geodesic: 6 },
      { pitch: 5, yaw: 6, roll: 7, geodesic: 12 },
      { pitch: 7, yaw: 8, roll: 9, geodesic: 20 },
    ]);
    assert.equal(summary.n, 4);
    assert.deepEqual(summary.maeDeg, { pitch: 4, yaw: 5, roll: 6, mean: 5 });
    close(summary.geodesicDeg.mean, 10.5);
    close(summary.geodesicDeg.median, 9);
    close(summary.geodesicDeg.p90, 17.6);
    assert.deepEqual(summary.shareWithinGeodesicDeg, { 5: 0.25, 10: 0.5, 15: 0.75 });
  });

  it('reports nulls for an empty set', () => {
    const summary = summarizePoseErrors([]);
    assert.equal(summary.n, 0);
    assert.equal(summary.maeDeg.mean, null);
    assert.equal(summary.geodesicDeg.median, null);
    assert.equal(summary.shareWithinGeodesicDeg[5], null);
  });
});

describe('correlation', () => {
  it('is 1 for a positive linear relation, -1 for a negative one and null without spread', () => {
    close(correlation([1, 2, 3], [2, 4, 6]), 1);
    close(correlation([1, 2, 3], [3, 2, 1]), -1);
    assert.equal(correlation([1, 1, 1], [1, 2, 3]), null);
  });
});
