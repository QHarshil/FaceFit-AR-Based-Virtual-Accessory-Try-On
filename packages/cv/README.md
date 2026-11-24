# @facefit/cv

Head-pose geometry for FaceFit: camera intrinsics, a GL projection matrix, a rigid face model, a PnP solver with outlier rejection, and metric scale from the iris. Pure TypeScript with no runtime dependencies and no DOM, MediaPipe or Three.js types. Equations and conventions: [docs/geometry.md](../../docs/geometry.md) and [docs/metric-scale.md](../../docs/metric-scale.md).

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
- `isValidIntrinsics(intrinsics)` is true when the focal lengths and image size are positive and finite and the principal point is finite.
- `projectPoint(intrinsics, pointCamera)` returns the pixel of a point in solver camera coordinates, or `null` at or behind the camera plane.
- `projectionMatrixFromIntrinsics(intrinsics, near, far)` returns a column-major 4x4 `Float64Array` for an OpenGL eye space that looks down -z. A solver camera point `(x, y, z)` is `(x, -y, -z)` in that space. Returns `null` for invalid input.
- `RIGID_FACE_LANDMARKS` holds the 33 Procrustes landmarks from MediaPipe's canonical face model, in millimetres, keyed by Face Mesh landmark index, with weights that sum to 1. Blink-affected landmarks are downweighted; see `src/faceModel.ts`. `RIGID_FACE_LANDMARK_INDICES` lists the same indices in order.
- `solveHeadPose(imagePoints, modelPoints, intrinsics, options)` pairs `imagePoints[i]` (pixels) with `modelPoints[i]`. It returns `{ ok: true, rotation, translationMm, rmsReprojectionPx, inlierIndices, iterations }`, where a model point `p` maps to `rotation * p + translationMm` in camera coordinates (x right, y down, z forward). On bad input, or a depth outside `minDepthMm` to `maxDepthMm` (default 100 to 5000), it returns `{ ok: false, reason }`. It never throws and never returns NaN. Points with weight 0 are ignored. At least `MIN_POINTS` (6) need positive weight, and the model points must span 3D.
- A solution also carries `uncertainty` (`HeadPoseUncertainty`): `rotationStdDeg` about the camera axes, `translationStdMm`, the 6x6 `covariance` over the rotation perturbation in radians and the translation, and `residualSigmaPx`, the pixel noise estimated from the residuals. It is first order, from the Jacobian at the solution scaled by the residual variance; see [docs/metric-scale.md](../../docs/metric-scale.md#pose-covariance).
- `rotation.ts` exports quaternion and matrix conversions, rotation-vector exp and log maps, and the angle between two rotations; `linalg.ts` exports the 3x3 matrix helpers and the `Mat3`, `Vec2` and `Vec3` types.

## Metric scale

`src/scale/` turns one frame's 478 Face Mesh landmarks (pixels) and its pose into millimetres. Every function returns `{ ok: false, reason }` instead of throwing or returning NaN.

```ts
import { estimateFaceScale, measureFaceWidth, measurePupillaryDistance, nearToDistancePd } from '@facefit/cv';

const scale = estimateFaceScale(landmarksPx, pose, intrinsics);
if (scale.ok) {
  const pd = measurePupillaryDistance(scale, pose);
  const distancePd = pd.ok ? nearToDistancePd(pd.nearPdMm, pd.fixationDistanceMm) : pd;
  const width = measureFaceWidth(landmarksPx, pose, intrinsics, scale);
}
```

- `fitIris(points, frame, options)` fits an iris's horizontal diameter and centre from its five landmarks, robust to one bad point; `irisDiameterPx(landmarksPx, eye)` applies it in pixels along the eye corners. `EYE_LANDMARKS` and `FACE_WIDTH_LANDMARKS` name the indices used.
- `estimateFaceScale` casts each eye's iris landmarks onto that eye's iris plane at the pose's canonical scale and returns `faceScale` (assumed iris diameter over the measured one, the wearer's size relative to the canonical face), `irisDepthMm`, `pnpDepthMm` and `mmPerPixel`. The assumed diameter is `POPULATION_IRIS_DIAMETER_MM`; the plane sits `IRIS_PLANE_OFFSET_MM` in front of the eye corners (SD `IRIS_PLANE_OFFSET_SD_MM`).
- `measurePupillaryDistance` gives near PD along the head's x axis and the fixation distance; `nearToDistancePd` converts to distance PD with a lever of `PUPIL_TO_ROTATION_CENTRE_MM` (SD `PUPIL_TO_ROTATION_CENTRE_SD_MM`). `measureFaceWidth` gives the width between landmarks 127 and 356 and `focalElasticity`, its sensitivity to the focal length.
- `measureFaceFrame(landmarksPx, poseResult, intrinsics)` runs all of the above for one frame and adds the signals a frame gate needs: line-of-sight yaw and pitch, eye openness, reprojection RMS in mm and rotation SD. It also turns the face width's focal sensitivity into an SD with `FOCAL_LENGTH_RELATIVE_SD`.
- `aggregateFaceMeasurements(frames, limits)` takes those frames in capture order and returns medians of near PD, distance PD and face width with 95% intervals, plus counts of rejected frames by reason. It accepts a frame only when the pose is trusted, the face is near frontal and the eyes are open (`DEFAULT_FACE_MEASUREMENT_LIMITS`), and returns `too-few-frames` below `minAcceptedFrames`. The interval combines the iris population spread, the standard error of the median and the modelled assumptions.

## Commands

```sh
npm install
npm test            # Vitest, synthetic ground truth with seeded noise
npm run typecheck   # tsc --noEmit
npm run bench       # solve time over 1,000 solves; merges into eval/results.json
```

The bench runs TypeScript directly, which needs Node 22.18 or newer.

## Face model data

`src/canonicalFaceModel.ts` is generated from MediaPipe's `canonical_face_model.obj` and `geometry_pipeline_metadata_landmarks.pbtxt` (Apache-2.0, see [third_party/mediapipe/LICENSE](third_party/mediapipe/LICENSE)). The script pins the source commit and SHA-256 of both files:

```sh
python3 -I scripts/convert_canonical_face_model.py <obj> <pbtxt> src/canonicalFaceModel.ts
```
