# Metric scale

Pupillary distance (PD) and face width in millimetres from one webcam, with a stated uncertainty, computed on the device. The head pose alone cannot give millimetres: a face twice the size at twice the distance projects the same. The iris breaks that tie, because its horizontal diameter varies little between adults. Code: [`packages/cv/src/scale/`](../packages/cv/src/scale/), measurement script: [`eval/scale/measure.mjs`](../eval/scale/measure.mjs). Frame and pose conventions follow [geometry.md](geometry.md).

## Landmarks

FaceLandmarker returns 478 landmarks; 468 to 477 are the two irises, a centre and four contour points each. On MediaPipe's output the horizontal contour pair is 469 and 471 (474 and 476 for the left eye). The vertical pair is shorter: its ratio to the horizontal pair is 0.873 and 0.876 on the two recordings (`landmarkDiagnostics.irisVerticalOverHorizontal`). The population figure is a horizontal diameter, so only the horizontal pair sets the scale. Eye corners (33, 133, 263, 362) give each eye's axis, lids (159, 145, 386, 374) give eye openness, and face-oval landmarks 127 and 356, at the height of the eye corners in front of the ears, give face width.

## Iris fit

`fitIris` works in coordinates $(u, v)$ along and across the eye's horizontal axis. The centre's $u$ is the median of three estimates that do not involve the horizontal pair (the centre landmark and both vertical points), and its $v$ the median of three that do not involve the vertical pair. With tolerance $\tau = \max(0.2\,r, 2\text{ px})$, $r$ the median distance from the centre landmark to the contour,

$$d_h = u_{h,2} - u_{h,1} \quad\text{if}\quad \left|\tfrac{1}{2}(u_{h,1} + u_{h,2}) - \tilde u\right| \le \tau,$$

and null otherwise. One bad point therefore leaves $d_h$ exact (a bad centre or vertical point, or a horizontal point moved across the axis), moves it by at most $2\tau$, or nulls it; a null eye is dropped and the other eye sets the scale. The fitted centre is the mean of the centre estimates within $\tau$ of the medians.

The two eyes check each other. Real left and right irises differ little, so when their diameters differ by more than 6%, one displaced horizontal point is the likely cause: it moves its pair's midpoint off $\tilde u$ by half the error it adds to $d_h$. The eye whose midpoint is further off is left out when the disagreement exceeds its $\tau$, its offset exceeds $\tau/2$, and the offset accounts for at least half the disagreement. A contour shrunk or grown about its centre keeps its midpoint, stays in, and is caught by the asymmetry gate below.

## Scale from the iris

The pose $(R, t)$ from `solveHeadPose` is at the canonical face's size. Each eye's iris plane passes through the eye point $P_e = R p_e + t$, where $p_e$ is the midpoint of the eye corners moved 6 mm toward the camera (a heuristic: the visible iris sits a few millimetres in front of the corners). The plane faces the camera, $n_e = -P_e / \lVert P_e \rVert$, because the wearer is assumed to fixate the camera. Its axes are the head's $x$ axis projected onto the plane, $a_u$, and $a_v = a_u \times n_e$. A landmark at pixel $(x, y)$ casts the ray $\mathbf d = ((x - c_x)/f_x, (y - c_y)/f_y, 1)$ onto the plane at

$$X = \frac{n_e \cdot P_e}{n_e \cdot \mathbf d}\,\mathbf d, \qquad (u, v) = \big(a_u \cdot (X - P_e),\ a_v \cdot (X - P_e)\big).$$

`fitIris` in these coordinates gives the horizontal diameter $d_c$ at canonical scale, averaged over the eyes. With the assumed diameter $D = 11.7$ mm,

$$s = \frac{D}{d_c}, \qquad Z_\text{iris} = s\,Z_\text{pnp}, \qquad \text{mm per pixel} = \frac{s\,Z_\text{pnp}}{f_x},$$

where $Z_\text{pnp}$ is the depth of the point between the eye points. $s$ is the wearer's size relative to the canonical face, and the ratio of iris-implied depth to PnP depth.

Casting onto a camera-facing plane removes the foreshortening of an off-centre eye; the head's axis removes roll; measuring along the head's $x$ axis removes the shortening of a turned head. If the eyes follow the head instead of the camera, the iris turns away by the angle $\theta$ between the head's forward axis and the line of sight, reads $\cos\theta$ narrow, and PD and face width read $1/\cos\theta$ large: 1.5% at the 10 degree gate.

## PD and face width

With fitted iris centres $c_R, c_L$ (camera coordinates, canonical scale) and head axis $x_h$,

$$\text{PD}_\text{near} = s\,\lvert (c_L - c_R) \cdot x_h \rvert = D\,\frac{\lvert (c_L - c_R) \cdot x_h \rvert}{d_c}.$$

Both distances are measured in the same planes, so a wrong focal length or plane depth cancels to first order. Face width casts 127 and 356 onto planes through their own canonical positions, facing along the head's $z$ axis, and takes $s$ times their separation along $x_h$. Those landmarks sit about 6 cm behind the irises, and the depth ratio that converts their image width depends on the absolute distance, which scales with the focal length $f$:

$$\frac{\partial \ln W}{\partial \ln f} = -\frac{Z_w - Z_e}{Z_w},$$

with $Z_w$ and $Z_e$ the depths of the face-width landmarks and the eye points. A misplaced iris plane shifts face width by the offset error over the iris depth.

## Near to distance PD

The camera sees the pupils converged on it. Each eye turns about its centre of rotation, $r = 10.5$ mm behind the entrance pupil (schematic-eye values: rotation centre 13.5 mm and entrance pupil about 3 mm behind the corneal apex; not measured here). Fixating a point at distance $F$ moves each pupil nasally by $r \sin\alpha$ with $\sin\alpha = (\text{PD}/2)/F$, so

$$\text{PD}_\text{near} = \text{PD}\left(1 - \frac{r}{F}\right), \qquad \text{PD} = \frac{\text{PD}_\text{near}}{1 - r/F}.$$

$F$ is the mean distance from the camera to the rotation centres, from the scaled pose. The correction's SD combines $r$ (SD 1.5 mm) and $F$ (20% relative SD, since $F$ scales with the assumed focal length and the wearer looks at the screen near the lens). The model assumes symmetric eyes, no phoria and fixation on the camera. Optician rules of 3 to 4 mm between near and distance PD are for lens centration at the spectacle plane, about 25 mm in front of the rotation centre, which moves further than the pupil does.

## Frames and intervals

`measureFaceFrame` measures one frame; `aggregateFaceMeasurements` combines frames in capture order. A frame counts when its reprojection RMS scaled to the face is at most 5 mm (the app's overlay threshold), the largest rotation SD is at most 2 degrees, the line of sight to the camera is within 10 degrees of the head's forward axis horizontally and 20 vertically, the face scale is between 0.55 and 1.45, and eye openness (lid gap over eye width, the smaller eye) is at least $\max(0.15, 0.9 \times \text{median})$. MediaPipe's iris contour narrows as the lids close: on the blink recording, frames between 0.9 and 0.95 of the median openness read the iris 1.42% narrow, and below half the median, 15.23% narrow (`irisWidthByRelativeOpenness`).

The two irises must agree. A frame whose right-over-left diameter ratio is further from 1 than 6% is rejected as `asymmetric-iris`; on the recordings the ratio's 1st to 99th percentiles stay inside that (`irisDiameterRatio`). When a clip's own ratios scatter more, as on synthetic faces with 1 px of independent noise per landmark, the frame tolerance widens to three robust SDs (1.4826 MAD) of them. The clip fails with `asymmetric-iris` when most frames are gated, or when its median log ratio is beyond $\ln 1.06$ plus three standard errors of the median, which catches a constant fault the per-frame scatter would hide.

Two checks catch an iris fit that cannot belong to the face. The fitted iris centre must lie inside its eye: an ellipse through the corners whose half-height on each side reaches that side's lid, or one iris radius when the lid is nearer, so closing eyes are left to the openness gate. The face scale must be plausible: the canonical eye spacing is 63 mm, the adult mean PD, so $s \approx \text{PD} / 63\text{ mm} \times D / D_\text{true}$, and PD from 41 mm (young children) to 78 mm (largest adults; [Dodgson, 2004](https://doi.org/10.1117/12.529999)) with an iris from 10.2 to 13.2 mm (3 SD) gives 0.58 to 1.42.

Each quantity reports the median over accepted frames and a 95% interval of half-width

$$1.96\sqrt{\left(m\,\frac{\sigma_D}{D}\right)^2 + \left(\sqrt{\tfrac{\pi}{2}}\,\frac{\text{SD}}{\sqrt{n_\text{eff}}}\right)^2 + \sigma_\text{model}^2}, \qquad n_\text{eff} = n\,\frac{1 - \rho}{1 + \rho}.$$

The first term is the iris population: $\sigma_D = 0.5$ mm about $D = 11.7$ mm (Google's 11.7 ± 0.5 mm read as mean and SD; the Tehran series, n = 410, gives a 95% range of 10.76 to 12.60 mm). Every frame shares the wearer's iris, so averaging cannot shrink it, and it is the same 4.3% for PD and face width. The second is the standard error of the median, with $\rho$ the lag-1 autocorrelation of the accepted frames, because consecutive video frames are not independent. The third is the near-to-distance correction for distance PD, and for face width the focal length (15% relative SD for an assumed 60 degree field of view against webcams of roughly 55 to 80) through the elasticity above, combined with a 3 mm SD on the iris plane offset. Fewer than 10 accepted frames return `too-few-frames`.

## Pose covariance

`solveHeadPose` reports first-order uncertainty at its solution. With $J$ the $2n \times 6$ Jacobian over the inliers, $W$ the landmark weights and $P = J (J^\top W J)^{-1} J^\top W$,

$$\Sigma_c = \hat\sigma^2 (J^\top W J)^{-1} (J^\top W^2 J) (J^\top W J)^{-1}, \qquad \hat\sigma^2 = \frac{\sum \lVert r_i \rVert^2}{2n - 12 + \operatorname{tr}(P^\top P)}.$$

The denominator is $E[\sum \lVert r_i \rVert^2]/\sigma^2$ for a weighted fit and reduces to $2n - 6$ for equal weights. The solver's translation is that of the weighted centroid $c$; the reported one is $t - Rc$, so $\Sigma = T \Sigma_c T^\top$ with $T = \begin{bmatrix} I & 0 \\ [Rc]_\times & I \end{bmatrix}$. The result carries `rotationStdDeg` about the camera axes, `translationStdMm`, the full covariance and `residualSigmaPx`. The Huber loss is left out, which holds while inliers sit inside the Huber scale.

## Results

From `runs["metric-scale"]` in [eval/results.json](../eval/results.json), Apple M4 Pro, Node 25.1, landmarks from `@mediapipe/tasks-vision` 1.2.3 on the CPU delegate in headless Chrome 158, VIDEO mode, 60 degree field of view assumed.

**Recordings** (two webcam clips, 360 frames each at 1280x720 and 30 fps; stability only, since no reference PD exists for them; no PD or face width is recorded):

| Clip | Accepted | Rejected (eyes closed) | Near PD frame SD | Face width frame SD | Near PD 95% half-width | Face width 95% half-width |
|------|----------|------------------------|------------------|---------------------|------------------------|---------------------------|
| static | 346 | 14 | 0.656% | 0.559% | 8.386% | 9.036% |
| blink | 295 | 65 | 0.518% | 0.532% | 8.384% | 9.058% |

The intervals are almost all population term. The two clips' medians differ by 0.459% for near PD and 0.745% for face width. Assuming a 50 or 70 degree field of view instead of 60 moves near PD by -0.074% and +0.102% and face width by -2.142% and +2.409% on the static clip, as the first-order argument predicts.

**Synthetic faces** (`packages/cv/test/syntheticFace.ts`, seeded): over 12 configurations of 300 frames (450 to 900 mm, yaw 0 and 8 degrees, 0.5 and 1 px), the frame SD of PD is 0.94 to 1.15 times the first-principles prediction. Over 1,000 subjects drawn from the iris population, each with a focal length and iris plane drawn from the modelled spreads, 20 frames each, the nominal 95% intervals cover the truth for 94.3% (near PD), 94.7% (distance PD) and 94.0% (face width). With the population term off, the noise term alone covers near PD for 95.8% of 600 subjects.

**Pose covariance** against the Monte Carlo spread of 1,000 solves at each of three poses: reported over observed SD is 0.955 to 1.033 (rotation) and 0.972 to 1.013 (translation) at 0.5 px, 0.947 to 0.988 and 0.935 to 1.002 at 1 px, and 0.876 to 0.932 at 2 px, where the Huber loss and rejection, which the formula leaves out, cost efficiency.

## Assumptions

- Horizontal visible iris diameter 11.7 mm, SD 0.5 mm, for every wearer.
- The wearer fixates the camera: the iris planes face it and the eyes converge on it.
- The visible iris lies 6 mm in front of the eye corners (SD 3 mm), and the face matches the canonical model up to scale.
- Centre of rotation 10.5 mm behind the entrance pupil (SD 1.5 mm).
- Focal length from a 60 degree horizontal field of view, square pixels and a centred principal point, with 15% relative SD.
- Landmark noise independent between frames apart from the lag-1 correlation the interval discounts.

## Limits

- **Population bias.** A fixed 11.7 mm iris puts each person's PD and face width off by their own iris ratio, about 4.3% (1 SD). Frames do not average it away, and PD and face width share it.
- **Gaze.** The camera-fixation assumption is exact only for a wearer looking at the lens; a gaze that follows the head overstates PD and face width by up to 1.5% inside the gate.
- **Glasses.** Corrective lenses magnify or shrink the iris behind them, so a myopic wearer's PD reads high and a hyperopic one's low; frames can also hide the eye corners. Google reports iris depth error rising from 4.3% to 4.8% with glasses ([Google Research, 2020](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/)). Measure without glasses. Coloured contact lenses change the visible iris.
- **Lighting and squinting.** Glare, low light and narrowed lids move the iris contour. The openness gate removes closed and closing eyes, but it is relative to the clip's median, so a wearer who squints throughout keeps every frame. MediaPipe reads the contour 2.4% to 4.0% narrow between half and 0.9 of the open-eye openness on the recordings; synthetic faces with the lids at 0.2 and 0.17 of the eye width and the contour 4% and 6% narrow read near PD 3.84% and 6.40% high (`synthetic.squint`), still inside the interval.
- **Focal length outside the assumed spread.** The face-width interval assumes the focal length within 15% (1 SD) of a 60 degree field of view. An 85 degree webcam has 0.63 times that focal length, and a portrait 720x1280 frame whose 60 degrees span the long side has 1.78 times it, since the app applies 60 degrees across the width. Over 400 synthetic wearers each, face-width coverage falls to 87.75% and 70.75%, while PD stays near 95% (`synthetic.coverage.focalOutsideAssumption`).
- **Rotation-SD gate.** The 2 degree limit on the pose's rotation SD exists because the solver's residuals on a real face mostly come from its mismatch with the canonical model. A face far from the canonical shape has larger residuals and a larger reported SD, and can be rejected as untrusted even when the pose is right.
- **Iris asymmetry below the gate.** One eye off by less than the asymmetry gate (6%, or three ratio SDs on a noisier clip) is not caught and moves PD by up to half of that.
- **Face width** depends on the focal length through the elasticity above and on silhouette landmarks that slide on a turned head.
- **Near-to-distance PD** uses schematic-eye constants and assumes fixation on the camera; it has not been checked against a pupillometer.
- **No real-world accuracy check.** Accuracy is shown on synthetic faces only. The recordings show stability, and no published webcam PD validation exists to compare with.
