# Head-pose filter

Two temporal filters for the solved head pose, compared by measurement: a One Euro filter and an error-state Kalman filter, both on SE(3) ([`packages/cv/src/filter/`](../packages/cv/src/filter/)). The app filters each trusted pose and predicts it to the frame on screen at every render ([`frontend/src/filtering/overlayPose.ts`](../frontend/src/filtering/overlayPose.ts)). Numbers come from `runs["pose-filter-sweep"]`, `runs["pose-filter"]` and the filter-off runs in [`eval/results.json`](../eval/results.json); the sweep's Pareto fronts are in [`eval/results/pose-filter-sweep.json`](../eval/results/pose-filter-sweep.json).

## Shared interface

`update(pose, t)` filters a pose measured at capture time $t$ and returns the estimate at $t$; `predict(t)` extrapolates it at constant velocity, clamped to $[t_\text{last}, t_\text{last} + 100\,\text{ms}]$; `reset()` drops the state. A gap over 200 ms or a non-increasing timestamp restarts the filter from the new pose: past six frames at 30 Hz the velocity is stale, and a restart has no lag. Past the 100 ms cap the prediction holds, so a stalled worker does not send the overlay along the old velocity, and a worker whose poses arrive more than 200 ms apart, each restarting the filter, keeps its last pose on screen. More than one second after the last update `predict` returns nothing and the app hides the overlay until the next pose: a render sees a pose up to about two inference times old, so this keeps a worker of up to about 450 ms per frame on screen (simulated with the app's frame scheduler in [`overlayPose.test.ts`](../frontend/src/filtering/__tests__/overlayPose.test.ts)). Rotations are unit quaternions differenced through the log map, which returns the shorter arc whatever the signs, so the sign flip `quaternionFromMatrix` makes where the rotation angle passes $\pi$ never reaches the filter.

## One Euro on SE(3)

With $\Delta t$ the time since the last update, a first-order low-pass with cutoff $f$ has the smoothing factor

$$\alpha(f, \Delta t) = \frac{\Delta t}{\Delta t + \tau}, \qquad \tau = \frac{1}{2\pi f},$$

exact for any $\Delta t$. Rotation (Casiez et al., CHI 2012, on the tangent space):

$$\omega_k = \frac{\log(q_k q_{k-1}^{-1})}{\Delta t}, \quad \hat\omega_k = \hat\omega_{k-1} + \alpha(f_d)\,(\omega_k - \hat\omega_{k-1}), \quad f_c = f_\text{min} + \beta \lVert\hat\omega_k\rVert,$$

$$\hat q_k = \exp\!\big(\alpha(f_c)\,\log(q_k \hat q_{k-1}^{-1})\big)\,\hat q_{k-1},$$

a slerp from $\hat q_{k-1}$ toward $q_k$. Each translation axis is its own One Euro filter with $|\hat v|$ in mm/s. `predict` returns $\exp(\hat\omega h)\,\hat q$ and $\hat p + \hat v h$.

At constant velocity the cutoff settles and the filter trails by exactly $\tau(f_c)$ for any frame interval: the lag $e$ obeys $e \leftarrow (1-\alpha)(e + v\Delta t)$, whose fixed point is $v\tau$. Extrapolating with $\hat v$ moves the estimate forward but leaves that lag. The tests check both, the noise gain $\sqrt{\alpha/(2-\alpha)}$ at rest, and the step response $1 - (1-\alpha)^n$.

## Error-state Kalman filter on SE(3)

Nominal state: rotation $q$, angular velocity $\omega$ in the camera frame, translation $p$, velocity $v$. Error state $\delta x = (\delta\theta, \delta\omega, \delta p, \delta v) \in \mathbb{R}^{12}$ with the rotation error on the tangent space as a left perturbation, $q_\text{true} = \exp(\delta\theta)\,q$.

**Process.** Constant velocity: $q \leftarrow \exp(\omega\Delta t)\,q$, $p \leftarrow p + v\Delta t$. The error moves as

$$F_\text{rot} = \begin{bmatrix} R(\omega\Delta t) & J_l(\omega\Delta t)\,\Delta t \\ 0 & I \end{bmatrix}, \qquad F_\text{trans} = \begin{bmatrix} I & I\Delta t \\ 0 & I \end{bmatrix},$$

with $R$ the rotation of $\omega\Delta t$ and $J_l$ the left Jacobian of SO(3), $\exp(\phi + d) \approx \exp(J_l(\phi)\,d)\exp(\phi)$. White acceleration of spectral density $q_c$ gives, per axis,

$$Q = q_c \begin{bmatrix} \Delta t^3/3 & \Delta t^2/2 \\ \Delta t^2/2 & \Delta t \end{bmatrix},$$

with $q_c = \sigma_\alpha^2$ for rotation and $\sigma_a^2$ for translation. Rotation and translation never mix, so the covariance is two $6 \times 6$ blocks.

**Measurement.** A solved pose $(q_m, p_m)$ gives the innovation $y = \big(\log(q_m q^{-1}),\; p_m - p\big)$ with $H = [I\;0]$ per block and $R = \operatorname{diag}(\sigma_\theta^2 I_3,\ \sigma_x^2, \sigma_y^2, \sigma_z^2)$. The update is the standard $K = PH^\top(HPH^\top + R)^{-1}$ with the covariance in Joseph form. The correction is folded into the nominal state, $q \leftarrow \exp(\delta\hat\theta)\,q$, and the rotation block is mapped to the new nominal rotation by $J_l(\delta\hat\theta)$. The measurement noise comes from the solved poses on rec-static: the RMS distance from a five-sample moving average, times $\sqrt{5/4}$ for the variance the average removes (`solvedPoseNoise` in the sweep). Only $\sigma_\alpha$ and $\sigma_a$ are swept.

The model matches constant-velocity motion, so the posterior and its prediction converge to the truth there: zero steady-state error, which the tests check under fixed and variable $\Delta t$. A step makes it overshoot, because the velocity it picks up while catching up carries it past. The tests also check the error transition against finite differences and the response at rest and on a step against an independent two-state filter at its steady-state gain.

## Timing in the app

Inference runs at camera rate (about 30 Hz) and rendering at display rate (60 Hz in the harness). Each trusted pose updates the filter at its frame's capture time. A frame without a face resets it; a gated frame does not, and the gap rule restarts the filter when the overlay was hidden longer than 200 ms. Each render predicts to the capture time of the newest frame the video has presented, which `requestVideoFrameCallback` reports before the render runs. That frame is what the overlay is composited over, and its landmarks are still in the worker for about one render, so the prediction covers the inference latency. Predicting to the render's own clock would put the overlay a render ahead of the video on every other render whenever the head moves. `VITE_POSE_FILTER` (`one-euro`, `kalman` or `off`; `one-euro` when unset) selects the filter at build time, and any other value fails the build; the harness records with `off`.

## Measurement

**Clips.** Besides the still and recorded clips, six motion clips move the first frame of `static.mp4` by a known amount in every frame (`MOTION` in [`eval/harness/conditions.mjs`](../eval/harness/conditions.mjs)): `step-x` jumps 80 px right and back every second, `ramp-x` moves at 240 px/s between -120 and +120 px, `ramp-x-60` and `ramp-x-30` at 60 and 30 px/s with a 4 s period, `sine-roll` rolls 10 degrees with a 2 s period (peak 31 degrees/s), and `sine-roll-slow` 3 degrees with a 4 s period (peak 4.7 degrees/s). Chrome's fake camera timestamps frames with timer jitter, so the frame callback's `mediaTime` alone picks the wrong clip frame for a share of frames (`mediaTimeMismatchShare` per motion clip). Each clip frame therefore carries its index as eight black or white squares in the top-left corner; the harness reads them in its own frame callback and joins them to the app's capture events by `mediaTime`, which both callbacks see for the same frame.

**Metrics.** Jitter is the RMS distance from a centred moving average over about 150 ms of what each render drew on rec-static, blinks masked. Lag is measured against the frame on screen at each render: on the step, the time from the first frame showing the step to the first render at 90% of it (median over the steps, which the 60 Hz renders quantize to about 17 ms); on the ramp and the sinusoid, the phase lag of the clip's fundamental, where the cross-correlation peaks for a pure delay. The position lag is the largest of the step lag and the delays on the three ramps, and the rotation lag the larger delay on the two rolls. A One Euro filter trails constant motion by $\tau(f_c)$ and its cutoff falls with speed, so the slowest clip can lag most; a lag from the fast ramp alone misses that. The 50 ms target for the step applies to every delay. Without any filter the step lag is one render: the first render after the step frame appears still has the old pose, because that frame's landmarks are in the worker.

**Sweep.** A harness run per parameter set is too slow for hundreds of points, so the sweep replays two runs recorded with the filter off, one per MediaPipe configuration (`numFaces` 2 in `runs["pose-filter-off"]`, 1 in `runs["pose-filter-off-1face"]`), through the same filter code offline ([`poseReplay.mjs`](../eval/harness/poseReplay.mjs)): each shown pose sample updates the filter at its capture time, a lost face resets it, and each recorded render predicts to the newest presented frame. The warmup's events run first. Without a filter the replay reproduces every recorded render (`replayErrorPx`). Rotation parameters are swept first against rotation jitter and the rotation lag, then translation parameters with the chosen rotation against position jitter and position lag ([`poseFilterSweep.mjs`](../eval/harness/poseFilterSweep.mjs)). In each stage the operating point is the least jitter among points with a lag under 50 ms, and the sweep reports any parameter of it that sits on an edge of its grid. The live run with the chosen filter (`runs["pose-filter"]`) then checks the replay's prediction.

![Jitter against lag](pose-filter.svg)

Each curve is the Pareto front of one filter's sweep on one MediaPipe configuration; the squares are the unfiltered pose. Regenerate with `node eval/harness/plotPoseFilter.mjs`.

## Results

| | `pose-integration` | `pose-filter-off-1face` | `pose-filter-off` | `pose-filter` | Replay | Target |
|---|---|---|---|---|---|---|
| `numFaces`, filter | 1, none | 1, none | 2, none | 2, One Euro | 2, One Euro | |
| Position jitter, rendered (px) | - | 1.44 | 1.64 | 1.16 | 1.21 | at most 0.5 |
| Position jitter, per frame (px) | 1.47 | 1.49 | 1.68 | 0.94 | - | |
| Rotation jitter, rendered (deg) | - | 0.219 | 0.748 | 0.334 | 0.335 | at most 0.1 |
| Rotation jitter, per frame (deg) | 0.220 | 0.229 | 0.788 | 0.329 | - | |
| Step lag to 90%, median / max (ms) | - | 16.9 / 18.0 | 26.9 / 37.0 | 35.5 / 52.0 | 36.8 / 70.8 | under 50 |
| Step overshoot, median (%) | - | 0.5 | 0.6 | 8.1 | 9.3 | |
| Ramp delay at 240 / 60 / 30 px/s (ms) | - | 21.3 / 28.6 / 41.5 | 29.8 / 26.4 / 27.6 | 30.9 / 35.1 / 36.8 | 31.0 / 35.8 / 36.7 | under 50 |
| Roll delay, fast / slow (ms) | - | 42.3 / 126.0 | 33.7 / 21.3 | 42.8 / 51.0 | 44.8 / 49.3 | under 50 |
| Blink shift, median (px) | 4.16 | 4.16 | 4.94 | 4.86 | 4.88 | |
| Gated share, still and recorded clips | 0.000 | 0.000 | 0.000 | 0.000 | - | |
| Worker inference p50, still / rec-static (ms) | 10.3 / 12.3 | 10.6 / 10.5 | 14.4 / 16.5 | 12.9 / 14.9 | - | |

`pose-integration` is the last run before filtering, `pose-filter-off-1face` and `pose-filter-off` this branch with the filter off, `pose-filter` the shipped filter live, and Replay the sweep's value for the same point. Apple M4 Pro on AC power, HeadlessChrome 158.0.0.0, GPU delegate, 1280x720 at 60 Hz rendering; rec-static is 10 s (554 renders, 277 pose samples, 1 blink masked live), each motion clip 8 s with 8 steps on step-x. Per-frame jitter is the filtered pose at each frame's capture time, the quantity `pose-integration` measured; rendered jitter is what the screen shows.

**Choice.** The One Euro filter at its swept point for two faces: rotation $f_\text{min}$ = 0.2 Hz, $\beta$ = 100 Hz per rad/s, $f_d$ = 0.25 Hz; translation $f_\text{min}$ = 4 Hz, $\beta$ = 0.01 Hz per mm/s, $f_d$ = 2 Hz (`ONE_EURO_OPTIONS`, the default `VITE_POSE_FILTER`). It meets every lag target in the replay, but live its delay on the slow roll is 51.0 ms, just over 50. It meets neither jitter target. No point on any front reaches 0.5 px (the least is 0.57 px, at over 500 ms of lag), and with two faces the rotation fronts reach 0.1 degrees only past 300 ms (317 ms One Euro, 337 ms Kalman).

The sweep's rule picked the Kalman point instead: $\sigma_\alpha$ = 0.139 rad/s² per √Hz, $\sigma_a$ = 64.6 mm/s² per √Hz, and the solved-pose noise on rec-static with two faces as measurement noise, $\sigma_\theta$ = 0.00888 rad and $\sigma_{x,y,z}$ = 0.878, 0.620, 2.853 mm (`KALMAN_OPTIONS`, still selectable). Its worst ratio of jitter to target was 3.20 against 3.35 for One Euro. Its constant-velocity model follows the ramps and rolls with almost no delay, so its rotation smoothing costs little lag. The live run with it (`runs["pose-filter-kalman"]`, recorded as `pose-filter` at commit 709133d) overrode the rule for two reasons. It drew 1.92 px of rendered position jitter, more than the 1.65 px of the same poses without a filter, and 1.27 px per frame: the step lag bounds its acceleration noise, and the prediction to the frame on screen adds noise back. And it overshot the step by 37%, so the glasses swing past the head after a quick move.

[`poseFilterReplayCheck.mjs`](../eval/harness/poseFilterReplayCheck.mjs) replays both points and no filter on the poses of `pose-filter-off`, `pose-filter-kalman` and `pose-filter` (`replayCheck` in the detail file). It reproduces what each live run drew to within $10^{-12}$ px. The rule's ranking changes with the run: Kalman's worst ratio is lower on two of the three (3.20 and 3.08 against 3.35 and 3.34), One Euro's on the third (3.66 against 3.84). On every run, though, the Kalman point leaves position jitter within 0.3 px of no filter (1.54 to 1.92 px against 1.64 to 1.65), overshoots the step by 36 to 38% and moves the overlay 6.6 to 6.7 px in a blink, against 1.16 to 1.45 px, 8 to 10% and 4.9 px for One Euro. One Euro's cost is rotation: 0.33 to 0.37 degrees against 0.28 to 0.32, with a worst roll delay of 49 to 51 ms against 18 to 21.

**Limits.** The motion clips move one recorded frame in the image plane: translation along x and roll about the viewing axis. They give the filter known motion but cover neither yaw, pitch nor depth, nor how the landmark model responds to a real moving face. rec-static is one recording of one person, and its high-pass jitter includes any real head motion above a few hertz. The replay reproduces the renders of runs with and without a filter, but landmark noise differs from run to run, so the live and replayed values of the chosen point differ by that much.

## MediaPipe's landmark filter

With `numFaces` 1, FaceLandmarker smooths landmarks with its own One Euro filter before the solver sees them, and with 2 it does not ([perception README](../frontend/src/perception/README.md)). Measured with the filter off on the same machine (`runs["pose-filter-off-1face"]` and `runs["pose-filter-off"]`, 10 s of rec-static and 8 s of each motion clip), with the operating points of the sweep for each configuration:

| | `numFaces` 1 | `numFaces` 2 |
|---|---|---|
| Landmark 168 jitter, still (px) | 0.009 | 0.288 |
| Landmark 168 jitter, rec-static (px) | 1.46 | 1.58 |
| Solved rotation jitter, rec-static (deg) | 0.229 | 0.788 |
| Landmark lag on the step (ms) | 0.0 | 0.0 |
| Landmark 168 delay on the ramps, 240 / 60 / 30 px/s (ms) | 3.3 / 12.0 / 23.2 | 0.0 / -0.6 / -1.7 |
| Eye-line delay on the rolls, fast / slow (ms) | 26.3 / 108.6 | 0.6 / -4.0 |
| Worker inference p50, still / rec-static (ms) | 10.6 / 10.5 | 14.4 / 16.5 |
| One Euro operating point: position (px) / rotation (deg) | 1.19 / 0.297 | 1.21 / 0.335 |
| Its worst position / rotation lag (ms) | 41.0 / 114.2 | 36.8 / 49.3 |
| Kalman operating point: position (px) / rotation (deg) | 1.63 / 0.282 | 1.60 / 0.290 |
| Its worst position / rotation lag (ms) | 35.6 / 109.1 | 36.8 / 20.6 |

**`numFaces` changed from 1 to 2.** MediaPipe's filter lowers its cutoff at low speed, so it delays slow motion most: 23 ms on the 30 px/s ramp and 109 ms on the slow roll, against 3 and 26 ms on the fast clips. Our filter stacks on that delay, so with one face no operating point of either filter gets the rotation lag under 50 ms (the best is 109 ms), and the selection, which then takes the least lag, sits at the top of the One Euro grid. With two faces the landmarks show no delay on any clip and both filters meet every lag target, so our filter sets all of the lag. The cost: the landmarks are noisier (0.009 to 0.288 px on the still clip; solved rotation on rec-static 0.229 to 0.788 degrees), the face detector runs on every frame where fewer than two faces are tracked, which raised worker inference from 10.6 to 14.4 ms on the still clip and from 10.5 to 16.5 ms on rec-static, and the blink shift rose from 4.16 to 4.94 px. Against `pose-integration` (one face, no filter), per-frame jitter is 0.94 px and 0.329 degrees live against 1.47 px and 0.220 degrees then. On the slow roll the overlay trails by 51.0 ms live against 126 ms with one face and no filter (`pose-filter-off-1face`). With more than one face in view the overlay stays on the face it started on, matched by position and size from frame to frame ([perception README](../frontend/src/perception/README.md)).
