# @facefit/cv

Head-pose geometry for FaceFit: camera intrinsics, a GL projection matrix, a rigid face model and a PnP solver with outlier rejection. Pure TypeScript with no runtime dependencies and no DOM, MediaPipe or Three.js types. Equations and conventions: [docs/geometry.md](../../docs/geometry.md).

## API

```ts
import { estimateIntrinsics, projectionMatrixFromIntrinsics, RIGID_FACE_LANDMARKS, solveHeadPose } from '@facefit/cv';

const intrinsics = estimateIntrinsics({ width: 1280, height: 720, horizontalFovDeg: 62 });
const imagePoints = RIGID_FACE_LANDMARKS.map(({ landmarkIndex }) => {
  const landmark = faceLandmarks[landmarkIndex];
  return [landmark.x * 1280, landmark.y * 720] as const;
});
const pose = solveHeadPose(imagePoints, RIGID_FACE_LANDMARKS, intrinsics, { initialPose: previousPose });
```

- `estimateIntrinsics` assumes square pixels and a centred principal point. Returns `null` for a non-positive size or a FOV outside (0, 180) degrees.
- `projectionMatrixFromIntrinsics(intrinsics, near, far)` returns a column-major 4x4 `Float64Array` for an OpenGL eye space that looks down -z. A solver camera point `(x, y, z)` is `(x, -y, -z)` in that space. Returns `null` for invalid input.
- `RIGID_FACE_LANDMARKS` holds the 33 Procrustes landmarks from MediaPipe's canonical face model, in millimetres, keyed by Face Mesh landmark index, with weights that sum to 1. Blink-affected landmarks are downweighted; see `src/faceModel.ts`.
- `solveHeadPose(imagePoints, modelPoints, intrinsics, options)` pairs `imagePoints[i]` (pixels) with `modelPoints[i]`. It returns `{ ok: true, rotation, translationMm, rmsReprojectionPx, inlierIndices, iterations }`, where a model point `p` maps to `rotation * p + translationMm` in camera coordinates (x right, y down, z forward). On bad input, or a depth outside `minDepthMm` to `maxDepthMm` (default 100 to 5000), it returns `{ ok: false, reason }`. It never throws and never returns NaN. Points with weight 0 are ignored. At least `MIN_POINTS` (6) need positive weight, and the model points must span 3D.
- `rotation.ts` exports quaternion and matrix conversions, rotation-vector exp and log maps, and the angle between two rotations.

## Commands

```sh
npm install
npm test            # Vitest, synthetic ground truth with seeded noise
npm run typecheck   # tsc --noEmit
npm run bench       # solve time over 1,000 solves; writes bench/results.json
```

The bench runs TypeScript directly, which needs Node 22.18 or newer.

## Face model data

`src/canonicalFaceModel.ts` is generated from MediaPipe's `canonical_face_model.obj` and `geometry_pipeline_metadata_landmarks.pbtxt` (Apache-2.0, see [third_party/mediapipe/LICENSE](third_party/mediapipe/LICENSE)). The script pins the source commit and SHA-256 of both files:

```sh
python3 -I scripts/convert_canonical_face_model.py <obj> <pbtxt> src/canonicalFaceModel.ts
```
