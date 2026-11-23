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

EPnP (Lepetit, Moreno-Noguer and Fua 2009) expresses each model point in barycentric coordinates of four control points (centroid and principal axes), solves for the control points in the camera frame from the null space of a $12 \times 12$ system, fits the null-space coefficients to the control-point distances, and recovers $R, t$ by Horn's absolute orientation. It needs the model points to span 3D. A previous pose passed as `initialPose` is a second candidate; refinement starts from whichever has the lower $E$.

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
