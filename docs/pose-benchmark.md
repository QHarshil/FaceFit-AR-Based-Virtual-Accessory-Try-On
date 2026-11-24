# Head-pose benchmark on AFLW2000-3D

Yaw, pitch and roll error of three head-pose methods run on the same MediaPipe landmarks. Code: [`eval/benchmark/`](../eval/benchmark/). Numbers: `runs["pose-benchmark-aflw2000"]` in [`eval/results.json`](../eval/results.json).

## Methods

- **Eye-line heuristic.** What the app does today (`updateGlasses` in [`ARTryOn.tsx`](../frontend/src/components/ARTryOn.tsx)), ported with the same constants to [`heuristicPose.mjs`](../eval/benchmark/heuristicPose.mjs). Hand-tuned gains on the angles of the line between the eyes, plus a fixed pitch offset. It is a heuristic, not a fitted model. A test fails if the app's formulas change and the port does not follow.
- **MediaPipe transformation matrix.** FaceLandmarker's facial transformation matrix, which maps MediaPipe's canonical face into a metric camera space. It assumes a 63 degree vertical FOV and an average face.
- **solveHeadPose.** The PnP solver in [`packages/cv`](../packages/cv/README.md) on the 33 `RIGID_FACE_LANDMARKS`, with pixels as normalized landmarks times 450 and intrinsics from an assumed FOV (below).

## Data and protocol

- **Dataset.** AFLW2000-3D: 2000 images at 450x450, each with `Pose_Para` from a 3D morphable model fit. Source, pinned hash and licence: [`eval/datasets/README.md`](../eval/datasets/README.md). Nothing from it is committed.
- **Landmarks.** `@mediapipe/tasks-vision` 1.2.3 with `face_landmarker.task` (float16, version 1, SHA-256 pinned), IMAGE mode, one face, default confidence thresholds of 0.5, CPU delegate. It runs in headless Chrome through `playwright-core`, the same engine and runtime as the app. The page is served from 127.0.0.1, every other request is aborted, and no host name resolves, so images and landmarks stay on the machine. The CPU delegate gives the same output on every machine; the app's GPU delegate can differ in the last bits.
- **Protocol.** Images with any label angle beyond 99 degrees are excluded, the common AFLW2000 protocol for head pose. Of the rest, images where FaceLandmarker finds no face are excluded and counted, per bin of absolute yaw. Metrics cover the images where all three methods return a pose, so each method is scored on the same set.
- **Metrics.** Per-axis absolute error, wrapped to (-180, 180] degrees, and its mean (MAE) per axis and over the three axes. Geodesic error is the angle of $R_\text{pred}^\top R_\text{label}$. The share of images within 5, 10 and 15 degrees uses the geodesic error. A rotation has two angle triples, one with $|\text{yaw}| \le 90°$ and one past it; errors use the triple closer to the label, which only matters for labels past 90 degrees of yaw.

## Conventions

Every method's rotation is expressed in one camera frame and decomposed with the dataset's own angle definition. No sign or offset was chosen by looking at the errors.

**Camera frame.** $x$ image-right, $y$ image-up, $z$ toward the viewer. A frontal, upright face has $R = I$.

**Dataset angles.** The archive ships the authors' MATLAB code. `RotationMatrix.m` builds, from pitch $\phi$, yaw $\gamma$ and roll $\theta$ (`Pose_Para(1:3)`, radians),

$$R = R_x(\phi)\,R_y(\gamma)\,R_z(\theta),\quad
R_x(\phi) = \begin{bmatrix} 1 & 0 & 0 \\ 0 & \cos\phi & \sin\phi \\ 0 & -\sin\phi & \cos\phi \end{bmatrix},\
R_y(\gamma) = \begin{bmatrix} \cos\gamma & 0 & -\sin\gamma \\ 0 & 1 & 0 \\ \sin\gamma & 0 & \cos\gamma \end{bmatrix},\
R_z(\theta) = \begin{bmatrix} \cos\theta & \sin\theta & 0 \\ -\sin\theta & \cos\theta & 0 \\ 0 & 0 & 1 \end{bmatrix}.$$

Each factor is the transpose of the right-handed rotation. `main_show_with_BFM.m` projects a model vertex $X$ to $f R X + t$, takes the first two coordinates and flips $y$ with $v = H + 1 - y$, and its lighting puts the viewer on $+z$. So $R$ maps the model face into the camera frame above. Multiplying out,

$$\gamma = \arcsin(-R_{02}),\qquad \phi = \operatorname{atan2}(R_{12}, R_{22}),\qquad \theta = \operatorname{atan2}(R_{01}, R_{00}).$$

Applied to the nose direction $(0, 0, 1)$ and the crown direction $(0, 1, 0)$: positive pitch raises the nose (looking up), positive yaw turns the nose toward image left (the subject turns to their right), and positive roll tips the crown toward image right (clockwise on screen).

**Each method in the camera frame.**

| Method | Native frame | Rotation in the camera frame |
|---|---|---|
| MediaPipe matrix | Metric space, right-handed, camera at the origin looking down $-z$, $y$ up; canonical face frontal at identity. 4x4, column-major. | Polar factor of the upper 3x3, which drops any uniform scale. A bottom row other than (0, 0, 0, 1) is rejected, which also catches a row-major matrix. |
| solveHeadPose | Camera $x$ right, $y$ down, $z$ forward; model is the canonical face with $y$ and $z$ negated ([geometry.md](geometry.md)). | $F R F$ with $F = \operatorname{diag}(1, -1, -1)$, since both camera and model flip $y$ and $z$. |
| Heuristic | Three.js scene, $x$ right, $y$ up, $z$ toward the camera. The video and the canvas are both mirrored by CSS, so the scene's $x$ is the unmirrored image's $x$. | Euler order `XYZ`: $R_x(\text{pitch}) R_y(\text{yaw}) R_z(\text{roll})$ with right-handed factors. |

Tests in [`conventions.test.mjs`](../eval/benchmark/conventions.test.mjs) check `RotationMatrix.m` entry by entry, the three.js Euler formula, the round trip through the decomposition, and the solver mapping on synthetic faces: a label pose is projected through 450x450 intrinsics, solved, mapped back and decomposed. Without noise the angles come back within $10^{-6}$ degrees. With 0.5 px of noise the per-axis MAE must stay under twice the linearized error from [geometry.md](geometry.md).

**Check on near-frontal images.** On images labelled within 30 degrees on every axis, two checks are recorded under `conventionCheck`. First, the labels against the dataset's own fitted landmarks (`pt3d_68`): the eye-line angle should rise with roll, the nose tip should move left of the eyes with yaw, and toward them with pitch. This confirms the reading of `Pose_Para` independently of any method. Second, each method's angles against the labels; a wrong sign shows as a negative correlation. Results are under Results below.

## Intrinsics assumption

AFLW2000 images are crops of Flickr photos, rescaled to 450x450, with unknown focal length, and the 3DDFA fit is weak perspective. solveHeadPose assumes a 63 degree FOV, horizontal and vertical since the images are square, with square pixels and the principal point at the image centre. The value was fixed before any run, to give solveHeadPose the camera MediaPipe assumes, so the two perspective methods differ only in the solver. A crop's true principal point is wherever the crop sat in the photo, so the centred principal point is also an assumption. The FOV sweep below shows how much the choice matters.

## Reproduce

Needs Google Chrome, `unzip` and Node 22.18 or newer (the scripts import `packages/cv` TypeScript directly).

```sh
cd eval && npm ci
node datasets/download-aflw2000.mjs        # fetch, check SHA-256, unpack into .cache/datasets
node benchmark/extract-landmarks.mjs       # FaceLandmarker on every image, cached in .cache/landmarks
node benchmark/pose-benchmark.mjs          # refuses a dirty tree; merges into results.json
node benchmark/pose-benchmark.mjs --table  # the tables below, from results.json
npm test
```

## Limits

- The labels come from fitting a 3D morphable model to 2D landmarks, not from motion capture. Their own error is not known here, and at large poses it can be a large part of what the table calls error.
- The methods are scored only on images where FaceLandmarker finds a face. Misses cluster at large yaw (counts per yaw bin are in `counts`), so the excluded images are the hard ones. Published learned models score every image within the protocol, so the numbers are not directly comparable.
- MediaPipe's canonical face and the dataset's mean face need not agree on what a level head is. A fixed tilt between the two face frames would show as a constant pitch error. It is reported as the mean signed error and not corrected, since correcting it would mean fitting to the labels.
- The focal length and principal point of the crops are unknown; see the sweep.
- The images are square. The heuristic works in normalized coordinates, so it has no aspect-ratio error here, while on 16:9 video its angles stretch.
- The app today runs the legacy `@mediapipe/face_mesh`. The heuristic is fed tasks-vision landmarks, which share its topology and index layout.

## Why not BIWI

BIWI's labels come from depth data, not a 2D model fit, which would complement AFLW2000. Its licence is non-commercial, its download URL at ETH returns 403, and the Hugging Face card holds only a loader script, so it is not included.
