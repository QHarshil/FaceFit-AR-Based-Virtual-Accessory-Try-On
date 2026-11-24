import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateIntrinsics } from '../../packages/cv/src/camera.ts';
import { RIGID_FACE_LANDMARKS } from '../../packages/cv/src/faceModel.ts';
import { mat3MulVec3 } from '../../packages/cv/src/linalg.ts';
import { solveHeadPose } from '../../packages/cv/src/pnp.ts';
import { angleBetweenRotations } from '../../packages/cv/src/rotation.ts';
import { seededRandom } from '../../packages/cv/test/random.ts';
import { projectWithNoise } from '../../packages/cv/test/syntheticPose.ts';
import {
  aflwAngles,
  aflwRotation,
  cameraRotationFromSolver,
  equivalentAflwAngles,
  polarRotation,
  rotationFromEulerXYZ,
  rotationFromMediapipeMatrix,
} from './conventions.mjs';

const DEG = Math.PI / 180;
const close = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);
const closeMatrix = (a, b, tolerance = 1e-12) => a.forEach((v, i) => close(v, b[i], tolerance, `entry ${i}`));
const randomAngles = (random, limitDeg) => ({
  pitch: random.uniform(-limitDeg, limitDeg) * DEG,
  yaw: random.uniform(-limitDeg, limitDeg) * DEG,
  roll: random.uniform(-limitDeg, limitDeg) * DEG,
});

describe('aflwRotation', () => {
  it('is RotationMatrix.m from 3DDFA: Rx(pitch) Ry(yaw) Rz(roll) with transposed factors', () => {
    const [p, y, r] = [0.3, -0.7, 1.1];
    const [cp, sp, cy, sy, cr, sr] = [Math.cos(p), Math.sin(p), Math.cos(y), Math.sin(y), Math.cos(r), Math.sin(r)];
    closeMatrix(aflwRotation({ pitch: p, yaw: 0, roll: 0 }), [1, 0, 0, 0, cp, sp, 0, -sp, cp]);
    closeMatrix(aflwRotation({ pitch: 0, yaw: y, roll: 0 }), [cy, 0, -sy, 0, 1, 0, sy, 0, cy]);
    closeMatrix(aflwRotation({ pitch: 0, yaw: 0, roll: r }), [cr, sr, 0, -sr, cr, 0, 0, 0, 1]);
    closeMatrix(aflwRotation({ pitch: p, yaw: y, roll: r }), [
      cy * cr, cy * sr, -sy,
      -cp * sr + sp * sy * cr, cp * cr + sp * sy * sr, sp * cy,
      sp * sr + cp * sy * cr, -sp * cr + cp * sy * sr, cp * cy,
    ]);
  });

  it('gives each positive angle the motion derived in docs/pose-benchmark.md', () => {
    // Camera frame: x image-right, y image-up, z toward the viewer.
    const nose = [0, 0, 1];
    const crown = [0, 1, 0];
    assert.ok(mat3MulVec3(aflwRotation({ pitch: 0.2, yaw: 0, roll: 0 }), nose)[1] > 0, 'positive pitch raises the nose');
    assert.ok(mat3MulVec3(aflwRotation({ pitch: 0, yaw: 0.2, roll: 0 }), nose)[0] < 0, 'positive yaw turns the nose to image left');
    assert.ok(mat3MulVec3(aflwRotation({ pitch: 0, yaw: 0, roll: 0.2 }), crown)[0] > 0, 'positive roll tips the crown to image right');
  });
});

describe('aflwAngles', () => {
  it('inverts aflwRotation on the principal branch', () => {
    const random = seededRandom(11);
    for (let i = 0; i < 500; i++) {
      const angles = randomAngles(random, 89);
      const recovered = aflwAngles(aflwRotation(angles));
      for (const axis of ['pitch', 'yaw', 'roll']) close(recovered[axis], angles[axis], 1e-9, axis);
    }
  });

  it('returns the equivalent triple for labels past 90 degrees of yaw', () => {
    const label = { pitch: 5 * DEG, yaw: 95 * DEG, roll: -3 * DEG };
    const principal = aflwAngles(aflwRotation(label));
    close(principal.yaw, 85 * DEG, 1e-9, 'principal yaw');
    const alternate = equivalentAflwAngles(principal);
    for (const axis of ['pitch', 'yaw', 'roll']) close(alternate[axis], label[axis], 1e-9, axis);
    closeMatrix(aflwRotation(alternate), aflwRotation(principal));
  });
});

describe('rotationFromEulerXYZ', () => {
  it("matches three.js makeRotationFromEuler for order 'XYZ'", () => {
    const [x, y, z] = [0.4, -0.2, 0.9];
    const [a, b, c, d, e, f] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
    // three.js writes te column-major: te[0], te[4], te[8] is the first row.
    closeMatrix(rotationFromEulerXYZ([x, y, z]), [
      c * e, -c * f, d,
      a * f + b * e * d, a * e - b * f * d, -b * c,
      b * f - a * e * d, b * e + a * f * d, a * c,
    ]);
  });
});

describe('cameraRotationFromSolver', () => {
  const intrinsics = estimateIntrinsics({ width: 450, height: 450, horizontalFovDeg: 63 });
  const DEPTH_MM = 300;

  // A label rotation in the camera frame becomes F R F in the solver frame,
  // F = diag(1, -1, -1), since both the model and the camera flip y and z.
  const solverPoseFor = (angles) => ({ rotation: cameraRotationFromSolver(aflwRotation(angles)), translationMm: [0, 0, DEPTH_MM] });

  const recoverAngles = (angles, sigmaPx, random) => {
    const pixels = projectWithNoise(solverPoseFor(angles), RIGID_FACE_LANDMARKS, intrinsics, sigmaPx, random);
    const solved = solveHeadPose(pixels, RIGID_FACE_LANDMARKS, intrinsics);
    assert.ok(solved.ok, solved.reason);
    return aflwAngles(cameraRotationFromSolver(solved.rotation));
  };

  it('is its own inverse', () => {
    const rotation = aflwRotation({ pitch: 0.3, yaw: -0.5, roll: 0.2 });
    closeMatrix(cameraRotationFromSolver(cameraRotationFromSolver(rotation)), rotation);
  });

  it('recovers label angles exactly from noise-free projections', () => {
    const random = seededRandom(5);
    for (let i = 0; i < 100; i++) {
      const angles = randomAngles(random, 40);
      const recovered = recoverAngles(angles, 0, random);
      for (const axis of ['pitch', 'yaw', 'roll']) close(recovered[axis], angles[axis], 1e-6 * DEG, axis);
    }
  });

  it('recovers label angles from noisy projections within the linearized error', () => {
    // docs/geometry.md: out-of-plane rotation error is about sigma Z / (f D),
    // D the weighted depth spread of the model about its centroid. The mean
    // absolute error of a zero-mean Gaussian is sqrt(2 / pi) times its std.
    // The bound doubles that for coupling with translation and non-frontal
    // poses. Roll is better constrained and shares the bound. A sign or axis
    // mistake errs by about twice the sampled angle, 20 degrees on average.
    const SIGMA_PX = 0.5;
    const TRIALS = 300;
    const totalWeight = RIGID_FACE_LANDMARKS.reduce((s, p) => s + p.weight, 0);
    const centroidZ = RIGID_FACE_LANDMARKS.reduce((s, p) => s + p.weight * p.positionMm[2], 0) / totalWeight;
    const depth = RIGID_FACE_LANDMARKS.map((p) => [p.weight, p.positionMm[2] - centroidZ]);
    const spreadMm = Math.sqrt(depth.reduce((s, [w, d]) => s + w * d * d, 0) ** 2 / depth.reduce((s, [w, d]) => s + w * w * d * d, 0));
    const boundDeg = (2 * Math.sqrt(2 / Math.PI) * SIGMA_PX * DEPTH_MM) / (intrinsics.fx * spreadMm) / DEG;

    const random = seededRandom(7);
    const sums = { pitch: 0, yaw: 0, roll: 0 };
    for (let i = 0; i < TRIALS; i++) {
      const angles = randomAngles(random, 40);
      const recovered = recoverAngles(angles, SIGMA_PX, random);
      for (const axis of Object.keys(sums)) sums[axis] += Math.abs(recovered[axis] - angles[axis]) / DEG;
    }
    for (const axis of Object.keys(sums)) assert.ok(sums[axis] / TRIALS < boundDeg, `${axis} MAE ${sums[axis] / TRIALS} >= ${boundDeg}`);
  });
});

describe('rotationFromMediapipeMatrix', () => {
  const columnMajor = (rotation, scale, t) => [
    scale * rotation[0], scale * rotation[3], scale * rotation[6], 0,
    scale * rotation[1], scale * rotation[4], scale * rotation[7], 0,
    scale * rotation[2], scale * rotation[5], scale * rotation[8], 0,
    t[0], t[1], t[2], 1,
  ];

  it('returns the rotation of a scaled column-major pose matrix', () => {
    const rotation = aflwRotation({ pitch: 0.2, yaw: -0.6, roll: 0.35 });
    const recovered = rotationFromMediapipeMatrix({ rows: 4, columns: 4, data: columnMajor(rotation, 1.07, [1.5, -2, -45]) });
    assert.ok(angleBetweenRotations(recovered, rotation) < 1e-12);
  });

  it('rejects a row-major layout, a wrong shape and a reflection', () => {
    const rotation = aflwRotation({ pitch: 0.2, yaw: -0.6, roll: 0.35 });
    const data = columnMajor(rotation, 1, [1.5, -2, -45]);
    const rowMajor = Array.from({ length: 16 }, (_, k) => data[(k % 4) * 4 + Math.floor(k / 4)]);
    assert.equal(rotationFromMediapipeMatrix({ rows: 4, columns: 4, data: rowMajor }), null);
    assert.equal(rotationFromMediapipeMatrix({ rows: 3, columns: 3, data: data.slice(0, 9) }), null);
    assert.equal(rotationFromMediapipeMatrix({ rows: 4, columns: 4, data: data.map((v, i) => (i === 0 ? NaN : v)) }), null);
    assert.equal(rotationFromMediapipeMatrix(undefined), null);
    assert.equal(polarRotation([-1, 0, 0, 0, 1, 0, 0, 0, 1]), null);
    assert.equal(polarRotation([0, 0, 0, 0, 1, 0, 0, 0, 1]), null);
  });
});
