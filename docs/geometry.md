# Head-pose geometry

The math behind `packages/cv`. Code: [`camera.ts`](../packages/cv/src/camera.ts), [`epnp.ts`](../packages/cv/src/epnp.ts), [`pnp.ts`](../packages/cv/src/pnp.ts).

## Frames

- **Pixels.** Origin at the top-left corner of the top-left pixel, $u$ right, $v$ down. A MediaPipe landmark maps to pixels as $(x W, y H)$.
- **Camera (solver).** $x$ right, $y$ down, $z$ along the optical axis.
- **Model.** Millimetres. MediaPipe's canonical face with $y$ and $z$ negated (a 180 degree rotation about $x$), so a frontal, upright face has $R = I$. The origin is MediaPipe's, inside the head behind the nose.
- **Pose.** $X_\text{cam} = R\,X_\text{model} + t$.

## Intrinsics from field of view

Without calibration, assume square pixels and a centred principal point:

$$f_x = f_y = \frac{W/2}{\tan(\text{HFOV}/2)}, \qquad c_x = W/2, \qquad c_y = H/2.$$

Projection: $u = f_x X/Z + c_x$, $v = f_y Y/Z + c_y$. A wrong FOV scales $f$, and the recovered depth scales with it to first order.

## GL projection matrix

An OpenGL renderer's eye space has $y$ up and looks down $-z$, so a solver camera point is $(x_e, y_e, z_e) = (X, -Y, -Z)$. NDC $y$ points up while pixel $v$ points down, so pixels relate to NDC by $u = (x_\text{ndc} + 1) W/2$ and $v = (1 - y_\text{ndc}) H/2$. Substituting the pinhole projection gives

$$
P = \begin{bmatrix}
\frac{2 f_x}{W} & 0 & 1 - \frac{2 c_x}{W} & 0 \\
0 & \frac{2 f_y}{H} & \frac{2 c_y}{H} - 1 & 0 \\
0 & 0 & -\frac{f + n}{f - n} & -\frac{2 f n}{f - n} \\
0 & 0 & -1 & 0
\end{bmatrix}
$$

with near $n$ and far $f$. The third-column terms move the image centre to $(c_x, c_y)$ and vanish for a centred principal point. The function returns it column-major, so $m_8 = 1 - 2c_x/W$ and $m_9 = 2c_y/H - 1$.

## Objective

For correspondences $u_i \leftrightarrow X_i$ with weights $w_i$ (normalized to mean 1) and inlier set $\mathcal{I}$:

$$E(R, t) = \sum_{i \in \mathcal{I}} w_i\, \rho\!\left(\lVert r_i \rVert^2\right), \qquad r_i = \pi(R X_i + t) - u_i,$$

where $\rho$ is the Huber loss with scale $c$ (default 3 px):

$$\rho(s) = \begin{cases} s & s \le c^2 \\ 2c\sqrt{s} - c^2 & s > c^2 \end{cases}$$

Huber is convex in the residual, unlike redescending losses. Past the scale, a point's gradient stops growing with its residual, so one bad landmark has bounded pull on the solution.

## Initial pose

EPnP (Lepetit, Moreno-Noguer and Fua 2009) expresses each model point in barycentric coordinates of four control points (centroid and principal axes), solves for the control points in the camera frame from the null space of a $12 \times 12$ system, fits the null-space coefficients to the control-point distances, and recovers $R, t$ by Horn's absolute orientation. It needs the model points to span 3D, and at least six of them: with four the null space is four-dimensional and the distance constraints leave the pose ambiguous, and five recover exact data but can land on a wrong pose under noise. The control-point distances, and the image under weak perspective, do not change when the camera-frame points are mirrored about a plane of constant depth, so with noise or an outlier the null-space solution can land on the mirror image and Horn's method returns a wrong rotation. Each of EPnP's three beta approximations therefore yields two candidates, as solved and mirrored about its weighted mean depth. A previous pose passed as `initialPose` is one more candidate; refinement starts from whichever has the lowest $E$.

A solve whose depth $t_z$ falls outside a plausible range (default 100 to 5000 mm) returns `implausible-depth`. A gross outlier on a heavy landmark can wreck every EPnP candidate, and refinement from there can settle on a face tens of metres away.

## Levenberg-Marquardt update

The model is centred on its weighted centroid and the update is $R \leftarrow \exp([\delta\omega]_\times) R$, $t \leftarrow t + \delta t$. With $q_i = R X_i$ and $X = q_i + t$:

$$J_i = \frac{\partial \pi}{\partial X} \begin{bmatrix} -[q_i]_\times & I \end{bmatrix}, \qquad \frac{\partial \pi}{\partial X} = \begin{bmatrix} f_x/Z & 0 & -f_x X/Z^2 \\ 0 & f_y/Z & -f_y Y/Z^2 \end{bmatrix}.$$

Each step solves

$$\left(H + \lambda\,\operatorname{diag}(H)\right)\delta = -g, \qquad g = \sum_i w_i \rho'_i J_i^\top r_i, \qquad H = \sum_i w_i \rho'_i J_i^\top (I - \alpha_i n_i n_i^\top) J_i,$$

with $\rho'_i = 1$ inside the Huber scale and $c / \lVert r_i \rVert$ outside. On the linear branch $\alpha_i = 1$ and $n_i = r_i / \lVert r_i \rVert$, because the loss has no curvature along the residual there; elsewhere $\alpha_i = 0$. Dropping that term turns this into plain reweighting, which overstates the curvature and converges only linearly.

Marquardt's diagonal scaling makes the damping independent of units (radians against millimetres). $\lambda$ starts at $10^{-3}$, drops tenfold after an accepted step and rises tenfold after a rejected one. Refinement stops when the relative cost decrease is at most $10^{-12}$, the step is negligible, $\lambda$ reaches $10^{12}$, or the iteration cap is hit.

## Outlier rejection

Rejection runs on an equal-weight copy of the problem, starting from the weighted fit. Five landmarks carry over half the weight (an effective count of 13 of 33), so a few shifted heavy landmarks drag a weighted fit toward themselves and keep their own residuals small. With equal weights no small group controls the fit, and every residual is tested against the same noise level. Each round refines on the current inliers, then takes $e_i = \lVert r_i \rVert$ over all points and

$$\tau = \max\!\left(\operatorname{med}(e) + k \cdot 1.4826 \cdot \operatorname{MAD}(e),\ \tau_\text{min}\right), \qquad k = 3,\ \tau_\text{min} = 2\text{ px}.$$

Points with $e_i \le \tau$ are inliers, and the six lowest residuals are always kept. Rounds stop when the inlier set repeats, after at most four. If any point was rejected, a weighted refinement on the inliers gives the pose, so the weights still decide the fit but not which points enter it. Since $\tau \ge \operatorname{med}(e)$, a round drops at most half the points.

For isotropic Gaussian noise of $\sigma$ per axis, $e$ is Rayleigh distributed, so $\operatorname{med}(e) = \sigma\sqrt{2\ln 2} \approx 1.18\sigma$, $\operatorname{MAD}(e) \approx 0.45\sigma$ and $\tau \approx 3.2\sigma$. An inlier exceeds it with probability $e^{-\tau^2/2\sigma^2} \approx 0.7\%$.

## Reprojection RMS as confidence

$$\text{rms} = \sqrt{\tfrac{1}{|\mathcal{I}|} \sum_{i \in \mathcal{I}} \lVert r_i \rVert^2}$$

unweighted, in pixels, over the inliers. For a correct pose it sits near the landmark noise level ($\sqrt{2}\sigma$ for isotropic noise, slightly less after fitting six parameters). It rises with expression changes the rigid model cannot explain, wrong correspondences, a wrong focal length, or a bad solve. The inlier count is a second signal.

## Expected error

Linearize the projections at the true pose, with $J$ the $2n \times 6$ Jacobian over $(\delta\omega, \delta t)$ and $W$ the weights. Under isotropic pixel noise $\sigma$ the weighted least-squares pose has covariance

$$\Sigma = \sigma^2 \left(J^\top W J\right)^{-1} \left(J^\top W^2 J\right) \left(J^\top W J\right)^{-1},$$

in sandwich form because the weights are not inverse variances. For a frontal face at depth $Z$, one parameter at a time, with depth offsets $d_i$ and in-plane radii $r_i$ about the centroid, it reduces to

$$\sigma_\text{yaw, pitch} \approx \frac{\sigma Z}{f D}, \qquad \sigma_Z \approx \frac{\sigma Z^2}{f R}, \qquad D^2 = \frac{(\sum w_i d_i^2)^2}{\sum w_i^2 d_i^2},$$

and $R$ is built from $r_i$ the same way. Out-of-plane rotation is the weakest because the face is shallower than it is wide, and depth error grows with $Z^2$.

The accuracy tests whiten each trial's rotation error and translation error by that trial's $\Sigma$. For a solver that attains $\Sigma$, the squared whitened error $e^\top \Sigma_{ee}^{-1} e$ is $\chi^2_3$ at any pose and distance, so its mean over $n$ trials (the NEES) is 3 with standard deviation $\sqrt{6/n}$. The bound is $\kappa\,(3 + z\sqrt{6/n})$ with $n = 2000$ and $z = 3.59$, a 0.1% family-wise false failure over six checks. The allowance

$$\kappa = \frac{1}{\left(1 - e^{-c^2/2\sigma^2}\right)\left(1 - e^{-\tau^2/2\sigma^2}\right)}$$

treats points past the Huber scale $c$ or the rejection threshold $\tau$ as carrying no information: 1.0003, 1.018 and 1.49 at $\sigma$ = 0.5, 1 and 2 px. EPnP without refinement and a pitch bias of 1.5 degrees per pixel both exceed the bound. Outlier tests whiten by the covariance of a fit to the uncorrupted points, the accuracy perfect rejection would reach, and bound the 95th percentile of the whitened error.

## In the app

[`frontend/src/geometry/headPose.ts`](../frontend/src/geometry/headPose.ts) runs once per landmark frame. Landmarks map to pixels of the camera frame as $(xW, yH)$, intrinsics come from an assumed 60 degree horizontal FOV, and `solveHeadPose` fits the 33 rigid landmarks, warm-started from the last trusted pose. The overlay hides when the solve fails, when no face is found, when the face's forward axis points away from the camera, or when the reprojection RMS scaled to the face,

$$\text{rms}_\text{mm} = \text{rms} \cdot \frac{t_z}{f_x},$$

exceeds 6 mm. The facing test rejects a mirrored landmark set, which fits the model with a flipped depth and a small RMS. A hidden overlay shows again only below 5 mm. The eval harness measures at most 3.58 mm for a still face and 4.53 mm through blinks, so 5 mm shows a blinking face at once, and a reading between 5 and 6 mm does not flip the overlay every frame.

The scaling removes the face's size in pixels from the gap between the wearer's face and the canonical one, and from the assumed FOV to first order, since $t_z$ scales with $f_x$. It does not remove it from landmark noise. For a fixed noise in pixels the RMS in millimetres grows in proportion to depth, so a far face reaches 6 mm sooner than a near one.

## Seating the frame

Models are in millimetres with the origin on the bridge, $x$ toward the wearer's left, $y$ up and $z$ toward the viewer ([assets/README.md](../assets/README.md)). That frame and the renderer's eye space ($y$ up, looking down $-z$) both differ from the solver's model and camera frames by a half turn about $x$, $H = \operatorname{diag}(1, -1, -1)$. A model point $p$ renders at

$$X_\text{eye} = H\left(R\,\big(s + H(p - b)\big) + t\right),$$

so the model gets rotation $HRH$ and position $H(Rs + t) - HRH\,b$, with $b$ the model's bridge anchor ([`glassesPlacement.ts`](../frontend/src/geometry/glassesPlacement.ts)). The seat $s$ is landmark 168 of the canonical face, $(0, -32.71, -52.36)$ mm, moved 3 mm toward the viewer. Landmark 168 is the midline point between the eyes. The models put the bridge 11 to 13 mm above the middle of the frame front, so this seat leaves the eyes in the upper half of the lenses; landmark 6, at eye level, would put them near the top rim. The 3 mm is a heuristic: the nose ridge rises about 2 mm in front of landmark 168 within the few millimetres below it that a bridge bar covers, plus 1 mm of clearance.

The camera sits at the origin with the projection from `projectionMatrixFromIntrinsics` (near 10 mm, far 10 m). The canvas renders at the video's intrinsic size and takes the video's `object-fit: cover` and mirror, so a rendered pixel covers the video pixel it was computed for.
