import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { estimateIntrinsics } from '../../packages/cv/src/index.ts';
import { PUPIL_TO_ROTATION_CENTRE_MM, PUPIL_TO_ROTATION_CENTRE_SD_MM } from '../../packages/cv/src/scale/measurements.ts';
import { seededRandom } from '../../packages/cv/test/random.ts';
import { poseFrom } from '../../packages/cv/test/scaleExperiments.ts';
import { AVERAGE_SUBJECT, renderSyntheticFace } from '../../packages/cv/test/syntheticFace.ts';
import { fitRegressionAttack, invertIntervalModel, rmsLogError } from './reconstruction.mjs';
import { assertRecordedClipFields, assertRecordingsFields, fieldPaths, RECORDED_CLIP_FIELDS, recordClip } from './summary.mjs';

const WIDTH = 1280;
const HEIGHT = 720;
const ASSUMED = estimateIntrinsics({ width: WIDTH, height: HEIGHT, horizontalFovDeg: 60 });
/** The iris population's relative SD, 0.5 / 11.7: the floor an attacker must not beat. */
const POPULATION_SPREAD = 0.5 / 11.7;

/**
 * Synthetic wearers drawn as the coverage tests draw them, each recorded
 * exactly as measure.mjs records a recorded clip, alongside the pipeline's
 * own face scale and face width, which an attacker would want.
 */
function syntheticWearers(count, seed) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => {
    const subject = {
      ...AVERAGE_SUBJECT,
      irisDiameterMm: 11.7 + random.gaussian(0.5),
      distancePdMm: 63 + random.gaussian(3.5),
      faceScale: random.uniform(0.9, 1.1),
      irisPlaneShiftMm: random.gaussian(3),
      pupilToRotationCentreMm: PUPIL_TO_ROTATION_CENTRE_MM + random.gaussian(PUPIL_TO_ROTATION_CENTRE_SD_MM),
    };
    const pose = poseFrom(random, 400, 750);
    const focalRatio = Math.exp(random.gaussian(0.15));
    const camera = { ...ASSUMED, fx: ASSUMED.fx * focalRatio, fy: ASSUMED.fy * focalRatio };
    const sigmaPx = random.uniform(0.3, 0.7);
    const faces = Array.from({ length: 40 }, () =>
      renderSyntheticFace(subject, pose, camera, sigmaPx, random).landmarksPx.map(([x, y]) => [x / WIDTH, y / HEIGHT]),
    );
    const { summary, record } = recordClip(faces, WIDTH, HEIGHT, 60);
    assert.ok(summary.ok, summary.reason);
    return { record, faceScale: summary.faceScale.median, faceWidthMm: summary.faceWidth.medianMm };
  });
}

/*
 * Every wearer's face scale and face width are known to the pipeline. An
 * attacker who sees only the recorded fields should do no better than
 * guessing, which here misses by the spread of the wearers' face scales
 * (uniform 0.9 to 1.1, 5.8%) combined with the iris population (4.3%). The
 * bound is the iris population spread alone, 4.3%: a field set that let an
 * attacker beat it would carry information about the absolute size.
 */
describe('recorded clip fields', () => {
  const train = syntheticWearers(150, 9301);
  const test = syntheticWearers(75, 9302);

  it('store exactly the allowed fields', () => {
    for (const { record } of test) {
      assert.deepEqual([...new Set(fieldPaths(record))].sort(), RECORDED_CLIP_FIELDS.measured.filter((path) => !/^(clipSha256|size|fps|landmarksExtracted)/.test(path)));
    }
    assert.throws(() => assertRecordedClipFields({ ...test[0].record, faceScaleFrameSdPercent: 0.5 }), /extra faceScaleFrameSdPercent/);
  });

  it('do not let the interval model be inverted to the face scale or face width', () => {
    const guesses = test.map(({ record }) => invertIntervalModel(record));
    const scaleError = rmsLogError(guesses.map((g) => g.faceScale), test.map((w) => w.faceScale));
    const widthError = rmsLogError(guesses.map((g) => g.faceWidthMm), test.map((w) => w.faceWidthMm));
    assert.ok(scaleError >= POPULATION_SPREAD, `face scale rebuilt within ${(100 * scaleError).toFixed(2)}%`);
    assert.ok(widthError >= POPULATION_SPREAD, `face width rebuilt within ${(100 * widthError).toFixed(2)}%`);
  });

  it('do not let a regression trained on synthetic wearers predict the face scale or face width', () => {
    const records = train.map((w) => w.record);
    const predictScale = fitRegressionAttack(records, train.map((w) => w.faceScale));
    const predictWidth = fitRegressionAttack(records, train.map((w) => w.faceWidthMm));
    const scaleError = rmsLogError(test.map((w) => predictScale(w.record)), test.map((w) => w.faceScale));
    const widthError = rmsLogError(test.map((w) => predictWidth(w.record)), test.map((w) => w.faceWidthMm));
    assert.ok(scaleError >= POPULATION_SPREAD, `face scale predicted within ${(100 * scaleError).toFixed(2)}%`);
    assert.ok(widthError >= POPULATION_SPREAD, `face width predicted within ${(100 * widthError).toFixed(2)}%`);
  });
});

describe('runs["metric-scale"] in eval/results.json', () => {
  it('stores exactly the allowed fields for the recordings', () => {
    const results = JSON.parse(readFileSync(new URL('../results.json', import.meta.url), 'utf8'));
    assert.doesNotThrow(() => assertRecordingsFields(results.runs['metric-scale'].recordings));
  });
});
