import {
  estimateIntrinsics,
  IDENTITY3,
  mat3MulVec3,
  projectPoint,
  RIGID_FACE_LANDMARKS,
  type HeadPose,
  type Vec3,
} from '@facefit/cv';
import { describe, expect, it } from 'vitest';
import { ANCHORS } from '../../test/fixtures';
import { rotationFromDegrees } from '../../test/syntheticFace';
import {
  BRIDGE_FORWARD_OFFSET_MM,
  CANONICAL_NOSE_BRIDGE_MM,
  glassesPointInFaceModel,
  glassesTransform,
  transformPoint,
} from '../glassesPlacement';

const DEG = 180 / Math.PI;
const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 60 })!;

const canonical = (index: number): Vec3 => {
  const landmark = RIGID_FACE_LANDMARKS.find((l) => l.landmarkIndex === index);
  if (!landmark) throw new Error(`landmark ${index} is not in the rigid set`);
  return landmark.positionMm;
};

// Eye space (y up, z toward the viewer) back to the solver camera frame, then pixels.
const eyePixel = (eye: Vec3) => projectPoint(intrinsics, [eye[0], -eye[1], -eye[2]])!;
const facePixel = (pose: HeadPose, modelPoint: Vec3) => {
  const camera = mat3MulVec3(pose.rotation, modelPoint);
  return projectPoint(intrinsics, [
    camera[0] + pose.translationMm[0],
    camera[1] + pose.translationMm[1],
    camera[2] + pose.translationMm[2],
  ])!;
};
const angleDeg = (a: readonly number[], b: readonly number[]) =>
  Math.atan2((b[1] as number) - (a[1] as number), (b[0] as number) - (a[0] as number)) * DEG;

describe('glassesTransform', () => {
  it('seats the bridge anchor in front of landmark 168 and keeps a frontal frame upright', () => {
    const pose: HeadPose = { rotation: IDENTITY3, translationMm: [10, -20, 600] };
    const transform = glassesTransform(pose, ANCHORS.bridgeCenter);
    expect(transform.rotation).toEqual(IDENTITY3);
    const bridge = transformPoint(transform, ANCHORS.bridgeCenter);
    const [x, y, z] = CANONICAL_NOSE_BRIDGE_MM;
    expect(bridge[0]).toBeCloseTo(x + 10, 9);
    expect(bridge[1]).toBeCloseTo(-(y - 20), 9);
    expect(bridge[2]).toBeCloseTo(-(z - BRIDGE_FORWARD_OFFSET_MM + 600), 9);
  });

  it('puts the left hinge on the image right of an unmirrored frontal face', () => {
    const pose: HeadPose = { rotation: IDENTITY3, translationMm: [0, 0, 600] };
    const transform = glassesTransform(pose, ANCHORS.bridgeCenter);
    const left = eyePixel(transformPoint(transform, ANCHORS.hingeLeft));
    const right = eyePixel(transformPoint(transform, ANCHORS.hingeRight));
    // Landmark 263 is the wearer's left outer eye corner.
    const leftEye = facePixel(pose, canonical(263));
    expect(left[0]).toBeGreaterThan(right[0]);
    expect(Math.sign(left[0] - intrinsics.cx)).toBe(Math.sign(leftEye[0] - intrinsics.cx));
  });

  it('keeps a bridge anchor away from the model origin on the seat', () => {
    const pose: HeadPose = {
      rotation: rotationFromDegrees(5, 20, -10),
      translationMm: [0, 0, 600],
    };
    const shifted: Vec3 = [1, 2, -3];
    const atOrigin = transformPoint(glassesTransform(pose, [0, 0, 0]), [0, 0, 0]);
    const atAnchor = transformPoint(glassesTransform(pose, shifted), shifted);
    atAnchor.forEach((value, axis) => {
      expect(value).toBeCloseTo(atOrigin[axis] as number, 9);
    });
  });

  it.each([
    { name: 'rolled', angles: [0, 0, 12] },
    { name: 'yawed', angles: [0, 25, 0] },
    { name: 'pitched, yawed and rolled', angles: [-15, -20, 8] },
  ])('moves rigidly with a $name head', ({ angles }) => {
    const pose: HeadPose = {
      rotation: rotationFromDegrees(angles[0] as number, angles[1] as number, angles[2] as number),
      translationMm: [30, 10, 550],
    };
    const transform = glassesTransform(pose, ANCHORS.bridgeCenter);
    // A glasses point placed on a face landmark renders where the face model puts it.
    const seat: Vec3 = [
      CANONICAL_NOSE_BRIDGE_MM[0],
      CANONICAL_NOSE_BRIDGE_MM[1],
      CANONICAL_NOSE_BRIDGE_MM[2] - BRIDGE_FORWARD_OFFSET_MM,
    ];
    for (const index of [4, 33, 263, 136]) {
      const face = canonical(index);
      // Face model offset from the seat, in the glasses frame (y and z flipped).
      const glassesPoint: Vec3 = [face[0] - seat[0], -(face[1] - seat[1]), -(face[2] - seat[2])];
      const rendered = eyePixel(transformPoint(transform, glassesPoint));
      const expected = facePixel(pose, face);
      expect(rendered[0]).toBeCloseTo(expected[0], 6);
      expect(rendered[1]).toBeCloseTo(expected[1], 6);
    }
  });

  it('turns the hinge line with the eye line under a roll about the optical axis', () => {
    for (const roll of [-15, -5, 5, 15]) {
      const pose: HeadPose = {
        rotation: rotationFromDegrees(0, 0, roll),
        translationMm: [0, 0, 600],
      };
      const transform = glassesTransform(pose, ANCHORS.bridgeCenter);
      const hinges = angleDeg(
        eyePixel(transformPoint(transform, ANCHORS.hingeRight)),
        eyePixel(transformPoint(transform, ANCHORS.hingeLeft)),
      );
      const eyes = angleDeg(facePixel(pose, canonical(33)), facePixel(pose, canonical(263)));
      expect(hinges).toBeCloseTo(roll, 9);
      expect(eyes).toBeCloseTo(roll, 9);
    }
  });
});

describe('bridge offset from landmark 168', () => {
  // A frontal face has R = I, so landmark 168 sits at camera depth z = tz + zModel
  // and height Y = yModel + ty, and the seat 3 mm nearer at z - 3 with the same
  // X and Y. Pinhole rows are cy + fy Y / z, so the seat moves by
  // fy Y (1 / (z - 3) - 1 / z), up the image for a landmark above the axis.
  it.each([
    { tz: 400, ty: 0 },
    { tz: 600, ty: 0 },
    { tz: 600, ty: 50 },
  ])('is the pinhole shift of a 3 mm move toward the camera at $tz mm', ({ tz, ty }) => {
    const pose: HeadPose = { rotation: IDENTITY3, translationMm: [0, ty, tz] };
    const bridge = eyePixel(
      transformPoint(glassesTransform(pose, ANCHORS.bridgeCenter), ANCHORS.bridgeCenter),
    );
    const landmark = facePixel(pose, CANONICAL_NOSE_BRIDGE_MM);

    const depth = tz + CANONICAL_NOSE_BRIDGE_MM[2];
    const height = CANONICAL_NOSE_BRIDGE_MM[1] + ty;
    const expectedDy =
      intrinsics.fy * height * (1 / (depth - BRIDGE_FORWARD_OFFSET_MM) - 1 / depth);

    expect(bridge[0] - landmark[0]).toBeCloseTo(0, 9);
    expect(bridge[1] - landmark[1]).toBeCloseTo(expectedDy, 9);
  });

  it('is about -0.91 px at 400 mm and -0.36 px at 600 mm for a centred face', () => {
    const offsetPx = (tz: number) => {
      const pose: HeadPose = { rotation: IDENTITY3, translationMm: [0, 0, tz] };
      const bridge = eyePixel(
        transformPoint(glassesTransform(pose, ANCHORS.bridgeCenter), ANCHORS.bridgeCenter),
      );
      return bridge[1] - facePixel(pose, CANONICAL_NOSE_BRIDGE_MM)[1];
    };
    expect(offsetPx(400)).toBeCloseTo(-0.908, 2);
    expect(offsetPx(600)).toBeCloseTo(-0.365, 2);
  });
});

describe('glassesPointInFaceModel', () => {
  it('lands on the same pixel through the head pose as the glasses transform puts it', () => {
    const pose: HeadPose = {
      rotation: rotationFromDegrees(-8, 20, 5),
      translationMm: [30, -15, 550],
    };
    for (const anchor of [ANCHORS.bridgeCenter, ANCHORS.hingeLeft, ANCHORS.hingeRight]) {
      const viaTransform = eyePixel(
        transformPoint(glassesTransform(pose, ANCHORS.bridgeCenter), anchor),
      );
      const viaFaceModel = facePixel(pose, glassesPointInFaceModel(anchor, ANCHORS.bridgeCenter));
      expect(viaFaceModel[0]).toBeCloseTo(viaTransform[0], 9);
      expect(viaFaceModel[1]).toBeCloseTo(viaTransform[1], 9);
    }
  });
});
