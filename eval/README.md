# Eval harness

Replays clips through the try-on page in Chrome as a fake camera and writes metrics to `results.json`. The app reports timings and poses through `probe()` (`frontend/src/utils/probe.ts`), which is a no-op unless the harness installs a sink.

The production build is served by `vite preview`, which sends the production CSP. The harness records every request from the page and its worker; a run that requests anything outside localhost or trips the CSP on the page fails and writes no results (`harness/network.mjs`). A `fetch` the CSP blocks inside the worker leaves no trace the harness can see (no request event, page violation or page console error), so the worker's guard (`frontend/src/perception/sameOriginGuard.ts`) refuses off-origin `fetch`, XHR, `importScripts` and `sendBeacon` first and reports each attempt as `blockedOffOriginAttempts`. Blocked attempts do not fail a run.

Two checks follow the conditions, and either failing also blocks results. The guard self-test issues an off-origin `fetch` and XHR inside the worker, requires each to be blocked or recorded, then waits up to 90 s for the MediaPipe usage log (`network.workerGuardSelfTest`). The CPU fallback run makes the first delegate fail after its loader ran and requires the CPU delegate to start (`cpuFallback`).

The head-pose accuracy benchmark on AFLW2000-3D lives in `benchmark/` and `datasets/`; see [docs/pose-benchmark.md](../docs/pose-benchmark.md).

## Run

Requires ffmpeg, Google Chrome and `npm ci` in `frontend/` and `backend/`. The harness serves the catalog from `backend/` on a fresh PGlite database in `.cache/api-db`, seeded from `assets/catalog.json`.

```sh
cd eval && npm install
fixtures/record.sh static 12 && fixtures/record.sh blink 12   # webcam clips, macOS
node fixtures/build.mjs --source recordings                   # Y4M clips in .cache/ (about 2 GB)
node harness/baseline.mjs --source recordings                 # refuses a dirty tree, and a commit made during the run
node harness/baseline.mjs --source recordings --clips <dir> --label <name>   # clips from another checkout, results key
node harness/baseline.mjs --source recordings --pose-filter off --label <name>   # VITE_POSE_FILTER for the build
node fixtures/build.mjs --source recordings --only motion --recordings <dir>  # motion clips only
node fixtures/build.mjs --source standin --only two-face      # the two-face clip only
node harness/poseFilterSweep.mjs --runs <label>[,<label>]   # replay filter-off runs through both filters; fronts in results/pose-filter-sweep.json
node harness/plotPoseFilter.mjs                             # docs/pose-filter.svg from the sweep's fronts
node harness/poseFilterReplayCheck.mjs --runs <label>[,<label>]   # both swept points on other runs' poses, into the sweep's file
node benchmark/gate-report.mjs                              # gate's hidden share by yaw (AFLW2000) and distance
npm test
```

Raw runs, warmup events included, go to `.cache/runs/<label>/`. The pose filter sweep and its method are in [docs/pose-filter.md](../docs/pose-filter.md).

## Conditions

| Id | Input | Measured |
|----|-------|----------|
| `still` | first frame of `static.mp4` with temporal noise | 10 s |
| `roll±5/10/15` | still frame rotated by a known angle | 3 s each |
| `dx±160/320`, `dy±120` | still frame shifted by known output pixels | 3 s each |
| `zoom0.75`, `zoom1.33` | still frame scaled | 3 s each |
| `product2` to `product4` | `still` clip with the other catalog models | 3 s each |
| `product2-zoom0.75` to `product4-zoom1.33` | zoom clips with the other catalog models | 3 s each |
| `rec-static`, `rec-blink` | recordings as captured | 10 s each |
| `step-x` | still frame stepping 80 px right and back every second | 8 s |
| `ramp-x` | still frame moving at 240 px/s between -120 and +120 px | 8 s |
| `ramp-x-60`, `ramp-x-30` | still frame moving at 60 and 30 px/s, 4 s period | 8 s each |
| `sine-roll` | still frame rolling 10 deg sin(2 pi t / 2 s) | 8 s |
| `sine-roll-slow` | still frame rolling 3 deg sin(2 pi t / 4 s), peak 4.7 deg/s | 8 s |
| `two-face` | the stand-in portrait twice side by side: the user on the left rolling 10 deg sin(2 pi t / 2 s) and moving between -60 and +60 px, a bystander at 0.8 of its size still on the right; built with `--source standin` only | 8 s |

The motion clips (`MOTION` in `harness/conditions.mjs`) draw the clip frame index as eight black or white squares along the top-left edge. The harness reads them in its own frame callback and joins them to the app's capture events by `mediaTime`; `mediaTime` alone picks the wrong clip frame for part of the frames (`mediaTimeMismatchShare`).

## Metrics

| Metric | Definition | Correct value |
|--------|------------|---------------|
| `inferenceMs` | `detectForVideo` duration, measured in the worker | lower |
| `frameToLandmarksMs` | frame callback (`requestVideoFrameCallback`) to the worker result arriving on the main thread | lower |
| `mainThreadPerFrameMs` | main-thread time per processed frame: the frame callback (capture and post) plus result handling, pose included | lower |
| `captureIntervalMs`, `inferenceIntervalMs`, `ratesHz` | time between camera frames and between worker results; events per measured second | inference rate equals camera rate |
| `framesDropped` | waiting frames replaced by a newer one before the worker took them | 0 |
| `pipelineMs` | frame callback to the end of the first render after that frame's pose; excludes camera and display latency | lower |
| `pipelineStepsMs` | each `pipelineMs` sample split into `frameToPost` (frame callback to `postMessage`), `queue` (post to inference start in the worker), `inference`, `delivery` (inference end to the reply arriving on the main thread) and `resultToRender` (reply to the end of the next render). Worker times are converted through `performance.timeOrigin`. Means add up to the mean pipeline | lower |
| jitter `rmsHighPass` | RMS distance from a centered moving average spanning about 150 ms (`windowSamples`: 9 at 60 Hz, 5 at 30 Hz), blinks masked | lower |
| `renderedPerFaceDeg` | slope of the screen angle of the line through the rendered hinge anchors against the face's eye-line angle | 1 |
| `gainX`, `gainY` | slope of the rendered bridge anchor's displacement against nose-bridge (landmark 168) displacement | 1 |
| `renderedOverFace` | distance between the rendered hinge anchors over face contour width (landmarks 234 to 454) | constant across zoom; `maxChangeFromStillPercent` per product |
| `gatedShare` | share of pose samples where the app hid the overlay: no face, a failed solve, or reprojection RMS over the gate | 0 on these clips |
| `rmsReprojectionMm` | solver reprojection RMS over its inliers, times depth over focal length: the residual in millimetres at the face | lower |
| blink shift | peak vertical displacement during a blink against the open-eye median before it | 0 |
| jitter `rendered` | `rmsHighPass` of what each render drew (`renderedPose` events, 60 Hz), with the blink mask carried over in time | lower |
| motion `error` | RMS and p95 of the value minus truth, after removing their median offset | lower |
| motion `stepLagMs` | per step, the presentation of the first frame showing it to the first sample at 90% of the step | lower |
| motion `overshootPercent` | per step, the peak past the new level in percent of the step | 0 |
| motion `delayMs` | phase lag of the clip's fundamental between value and truth sampled at the same times, where their cross-correlation peaks for a pure delay; null when `gain`, the ratio of their fitted amplitudes, is below 0.5 | 0 |
| motion `constantVelocityLagMs` | half the difference of truth minus value between falling and rising ramp segments, over the speed | 0 |
| `twoFace` `trackedOnBystander`, `rendersOnBystander` | pose samples whose tracked nose bridge (landmark 168), and renders whose bridge anchor, fall in the bystander's half of the video; `trackIds` lists the tracked face's ids and `bothFacesDetectedShare` the share of pose samples with both faces detected | 0, one id, near 1 |

Motion metrics come in three series: `rendered`, what each render drew against the frame on screen at that render; `smoothed`, the filtered pose of each processed frame against that frame's truth; and `face`, the landmarks themselves (landmark 168 for `dx`, the eye line for roll). `rendered` includes the pipeline; `smoothed` and `face` include only filtering, MediaPipe's or ours. `summary.solver.gatedShare` leaves the motion clips out so it stays comparable with older runs.

Screen quantities are CSS pixels at a 1280x720 viewport, from the pose samples the app rendered; gated samples count only toward `gatedShare`. The app projects its anchors through the same `object-fit: cover` fit as the video before reporting them.

The `smoothed` keys are the filtered pose at each processed frame's capture time, before a render predicts it forward; in runs with no filter they equal the `raw` ones.

Runs before `pose-integration` placed the glasses with the eye-line heuristic: every sample was rendered, the rendered ends are the edges of the model's bounding box along its x axis, and the roll and blink keys are `heuristic*PerFaceRollDeg` and `currentAnchorShiftPx`.

Runs before `perception-worker` (`baseline-recordings`, `parity-vite`) ran the legacy Face Mesh on the main thread once per animation frame: their `inferenceMs` is the `FaceMesh.send` duration including the results callback, `inferenceIntervalMs` is the animation frame interval, and the jitter window is 9 samples. Their `pipelineMs` starts at the animation frame callback. The frame callback that starts it in later runs fires in the same rendering step, just before animation frame callbacks, so the two are comparable. Blink windows (`before`, `settle`, the mask margin) count pose updates, not milliseconds.
