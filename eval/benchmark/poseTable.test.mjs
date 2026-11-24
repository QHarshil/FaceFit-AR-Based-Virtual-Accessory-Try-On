import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { renderConventionCheck, renderPoseTable } from './poseTable.mjs';

const method = (mae, median, within) => ({
  maeDeg: { yaw: mae[0], pitch: mae[1], roll: mae[2], mean: (mae[0] + mae[1] + mae[2]) / 3 },
  geodesicDeg: { median },
  shareWithinGeodesicDeg: { 5: within[0], 10: within[1], 15: within[2] },
});

const ENTRY = {
  commit: '0123456789abcdef',
  hardware: { cpu: 'Test CPU' },
  counts: { images: 2000, beyondProtocolLimit: 31, inProtocol: 1969, noFaceInProtocol: 19, evaluated: 1948 },
  fovAssumption: { degrees: 63 },
  methods: {
    heuristic: method([20, 10, 6], 22.5, [0.01, 0.1, 0.3]),
    mediapipeMatrix: method([4, 6, 3], 6.25, [0.3, 0.7, 0.9]),
    solveHeadPose: method([5, 7, 4], 7.5, [0.25, 0.65, 0.875]),
  },
  conventionCheck: {
    nearFrontalLimitDeg: 30,
    labelGeometry: {
      n: 1200,
      rollVsEyeLineAngle: { expectedSign: 1, correlation: 0.9612 },
      yawVsNoseOffset: { expectedSign: -1, correlation: -0.85 },
      pitchVsNoseHeight: { expectedSign: -1, correlation: null },
    },
    methods: {
      n: 1100,
      heuristic: { pitch: { correlation: 0.01, meanSignedErrorDeg: 1.5 }, yaw: { correlation: 0.9, meanSignedErrorDeg: -0.25 }, roll: { correlation: -0.95, meanSignedErrorDeg: 4 } },
      mediapipeMatrix: { pitch: { correlation: 0.93, meanSignedErrorDeg: 2 }, yaw: { correlation: 0.97, meanSignedErrorDeg: 0 }, roll: { correlation: 0.99, meanSignedErrorDeg: 0.1 } },
      solveHeadPose: { pitch: { correlation: 0.92, meanSignedErrorDeg: 3 }, yaw: { correlation: 0.97, meanSignedErrorDeg: 0.1 }, roll: { correlation: 0.98, meanSignedErrorDeg: 0.1 } },
    },
  },
  sensitivity: {
    solveHeadPoseByFovDeg: {
      30: { maeDeg: { mean: 6.5 }, geodesicMedianDeg: 7, failures: 0 },
      63: { maeDeg: { mean: 5.333 }, geodesicMedianDeg: 7.5, failures: 1 },
    },
  },
};

describe('renderPoseTable', () => {
  it('renders counts, the method table and the FOV sweep', () => {
    const lines = renderPoseTable(ENTRY).split('\n');
    assert.match(lines[0], /^AFLW2000-3D, 1948 of 2000 images evaluated: 31 excluded for a label beyond 99 deg, 19 for no detected face, 2 for a failed pose\. solveHeadPose assumes a 63 deg FOV\. Commit `012345678`, Test CPU\.$/);
    assert.ok(lines.includes('| Eye-line heuristic (old app pose) | 20.00 | 10.00 | 6.00 | 12.00 | 22.50 | 1.0% / 10.0% / 30.0% |'));
    assert.ok(lines.includes('| solveHeadPose | 5.00 | 7.00 | 4.00 | 5.33 | 7.50 | 25.0% / 65.0% / 87.5% |'));
    assert.ok(lines.includes('| solveHeadPose FOV (deg) | 30 | 63 |'));
    assert.ok(lines.includes('| Mean MAE (deg) | 6.50 | 5.33 |'));
    assert.ok(lines.includes('| Failed solves | 0 | 1 |'));
  });

  it('renders the near-frontal sign checks', () => {
    const lines = renderConventionCheck(ENTRY).split('\n');
    assert.equal(lines[0], "Labels within 30 deg on every axis. Labels against the dataset's fitted landmarks (`pt3d_68`), n = 1200:");
    assert.ok(lines.includes('| Eye-line angle, image y down | roll | + | 0.96 |'));
    assert.ok(lines.includes('| Nose tip below the eyes, over eye-to-mouth distance | pitch | - | n/a |'));
    assert.ok(lines.includes('| Eye-line heuristic (old app pose) | 0.01 (+1.50) | 0.90 (-0.25) | -0.95 (+4.00) |'));
    assert.ok(lines.includes('| MediaPipe transformation matrix | 0.93 (+2.00) | 0.97 (+0.00) | 0.99 (+0.10) |'));
  });

  it('matches the tables in docs/pose-benchmark.md for the recorded run', () => {
    const results = JSON.parse(readFileSync(new URL('../results.json', import.meta.url), 'utf8'));
    const entry = results.runs['pose-benchmark-aflw2000'];
    assert.ok(entry, 'eval/results.json has no pose-benchmark-aflw2000 run');
    const doc = readFileSync(new URL('../../docs/pose-benchmark.md', import.meta.url), 'utf8');
    const stale = 'docs/pose-benchmark.md is stale; paste `node eval/benchmark/pose-benchmark.mjs --table`';
    assert.ok(doc.includes(renderPoseTable(entry)), stale);
    assert.ok(doc.includes(renderConventionCheck(entry)), stale);
  });
});
