import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { rotationFromEulerXYZ } from './conventions.mjs';
import { heuristicEuler, heuristicRotation } from './heuristicPose.mjs';

const landmarksWith = (overrides) => {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [indices, point] of overrides) for (const i of indices) landmarks[i] = point;
  return landmarks;
};

const FACE = [
  [[33, 133, 159, 145], { x: 0.4, y: 0.5, z: 0 }],
  [[362, 263, 386, 374], { x: 0.6, y: 0.55, z: 0.05 }],
  [[10], { x: 0.5, y: 0.3, z: 0 }],
  [[234], { x: 0.3, y: 0.5, z: 0 }],
  [[454], { x: 0.7, y: 0.5, z: 0 }],
];

describe('heuristicEuler', () => {
  it('matches the app source it ports', () => {
    const source = readFileSync(new URL('../../frontend/src/components/ARTryOn.tsx', import.meta.url), 'utf8');
    for (const line of [
      'const LEFT_EYE_INDICES = [33, 133, 159, 145];',
      'const RIGHT_EYE_INDICES = [362, 263, 386, 374];',
      'const LEFT_TEMPLE_INDEX = 234;',
      'const RIGHT_TEMPLE_INDEX = 454;',
      'const FOREHEAD_INDEX = 10;',
      'const eyeVector = rightEye.clone().sub(leftEye);',
      'const yaw = Math.atan2(eyeVector.z, eyeVector.x) * 0.8;',
      'const pitch = Math.atan2(-eyeVector.y, horizontalMagnitude) * 0.75 + 0.08;',
      'const verticalReference = browPoint.clone().sub(eyeMidpoint);',
      'const roll = Math.atan2(eyeVector.y, eyeVector.x) * 0.55 + verticalReference.y * 0.3;',
      "new THREE.Euler(pitch, yaw, roll, 'XYZ')",
    ]) {
      assert.ok(source.includes(line), `ARTryOn.tsx no longer contains: ${line}`);
    }
  });

  it('gives the hand-computed angles for a tilted eye line', () => {
    // Eye vector (0.2, 0.05, 0.05), eye midpoint y 0.525, forehead y 0.3.
    const [pitch, yaw, roll] = heuristicEuler(landmarksWith(FACE));
    assert.ok(Math.abs(pitch - -0.09845584362265618) < 1e-12);
    assert.ok(Math.abs(yaw - 0.19598293050149132) < 1e-12);
    assert.ok(Math.abs(roll - 0.06723826471977529) < 1e-12);
  });

  it('keeps the constant pitch offset on a level eye line', () => {
    const level = landmarksWith([...FACE, [[362, 263, 386, 374], { x: 0.6, y: 0.5, z: 0 }]]);
    const [pitch, yaw, roll] = heuristicEuler(level);
    assert.equal(yaw, 0);
    assert.ok(Math.abs(pitch - 0.08) < 1e-15);
    assert.ok(Math.abs(roll - -0.06) < 1e-15);
  });

  it('returns null where the app hides the glasses', () => {
    const collapsed = landmarksWith([...FACE, [[454], { x: 0.3, y: 0.5, z: 0 }]]);
    assert.equal(heuristicEuler(collapsed), null);
    assert.equal(heuristicRotation(collapsed), null);
    assert.equal(heuristicEuler(landmarksWith([...FACE, [[454], { x: NaN, y: 0.5, z: 0 }]])), null);
  });

  it('turns the angles into the XYZ rotation the app applies', () => {
    const landmarks = landmarksWith(FACE);
    assert.deepEqual(heuristicRotation(landmarks), rotationFromEulerXYZ(heuristicEuler(landmarks)));
  });
});
