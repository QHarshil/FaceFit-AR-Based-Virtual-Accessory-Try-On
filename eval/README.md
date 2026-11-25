# Eval harness

Replays clips through the try-on page in Chrome as a fake camera and writes metrics to `results.json`. The app reports timings and poses through `probe()` (`frontend/src/utils/probe.ts`), which is a no-op unless the harness installs a sink.

The production build is served by `vite preview`, which sends the production CSP. The harness records every request from the page and its worker; a run that requests anything outside localhost or trips the CSP on the page fails and writes no results (`harness/network.mjs`). A `fetch` the CSP blocks inside the worker leaves no trace the harness can see (no request event, page violation or page console error), so the worker's guard (`frontend/src/perception/sameOriginGuard.ts`) refuses off-origin `fetch`, XHR, `importScripts` and `sendBeacon` first and reports each attempt as `blockedOffOriginAttempts`. Blocked attempts do not fail a run.

Two checks follow the conditions, and either failing also blocks results. The guard self-test issues an off-origin `fetch` and XHR inside the worker, requires each to be blocked or recorded, then waits up to 90 s for the MediaPipe usage log (`network.workerGuardSelfTest`). The CPU fallback run makes the first delegate fail after its loader ran and requires the CPU delegate to start (`cpuFallback`).

The head-pose accuracy benchmark on AFLW2000-3D lives in `benchmark/` and `datasets/`; see [docs/pose-benchmark.md](../docs/pose-benchmark.md).

`scale/measure.mjs` measures metric scale (iris-based PD and face width) on the recordings and on synthetic faces, and writes `runs["metric-scale"]`. For recordings it records only fields that cannot rebuild a PD, face width or face scale; see [docs/metric-scale.md](../docs/metric-scale.md). It caches the recordings' landmark tracks in `.cache/landmarks/clips/` while it runs and deletes them when it ends, unless `--keep-landmarks` is passed.

## Run

Requires ffmpeg, Google Chrome and `npm ci` in `frontend/` and `backend/`. The harness serves the catalog from `backend/` on a fresh PGlite database in `.cache/api-db`, seeded from `assets/catalog.json`.

```sh
cd eval && npm install
fixtures/record.sh static 12 && fixtures/record.sh blink 12   # webcam clips, macOS
node fixtures/build.mjs --source recordings                   # Y4M clips in .cache/ (about 2 GB)
node harness/baseline.mjs --source recordings                 # refuses a dirty tree, and a commit made during the run
node harness/baseline.mjs --source recordings --clips <dir> --label <name>   # clips from another checkout, results key
node scale/measure.mjs --clips <dir>                          # metric scale; refuses a dirty working tree
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

## Browser tests

Playwright Test (`playwright.config.mjs`) runs the production build under `vite preview` with its CSP. The API is answered by route handlers. Every test checks that no request left localhost and the CSP reported nothing. CI runs one job per engine and uploads the HTML report, with traces and screenshots, when a test fails.

| Spec | What it covers | Engines |
|------|----------------|---------|
| `chromium.spec.mjs` | tracking with axe on the catalogue and try-on, a product request that fails on the network, a missing face model, a lost WebGL context, a hidden tab | Chromium |
| `cross-browser.spec.mjs` | catalogue, credits, the 404 page, an unknown product, keyboard entry to a frame, axe, the camera starting | all three |
| `denied.spec.mjs` | a blocked camera, the photo fallback, axe | all three |
| `accessibility.spec.mjs` | axe on the catalogue, the 404 page and the try-on while tracking, searching (a grey canvas as the camera), model failed, product not found, camera denied and photo showing; serious and critical violations fail | Chromium |
| `layout.spec.mjs` | the rendered glasses against the face's bridge landmark, mapped through the `object-fit: cover` crop and the mirror, at 1280x720 DPR 1 (the control, `chromium-desktop`), 390x844 DPR 3 (`chromium-phone`) and 844x390 DPR 2 with the face 160 px right of centre (`chromium-landscape`). Checks the CSS the projection assumes, the point the app reports drawing, and the pixels the overlay adds to a screenshot. The tolerance is 0.1 of the interocular distance on screen, from the 0.053 to 0.061 the runs measure; the justification is in the spec's header | Chromium |
| `keyboard.spec.mjs` | Tab from the catalogue into a frame, to every recovery action of a blocked camera, into photo mode and back, and out to the catalogue; each stop shows a focus ring and Tab never sticks | Chromium |

The camera differs by engine, and the specs run what each one supports:

| Engine | Camera | Skipped, and why |
|--------|--------|------------------|
| Chromium | the stand-in portrait as a fake camera, so the face is tracked | nothing |
| Firefox | its generated stream (`media.navigator.streams.fake`), which holds no face, so the try-on stops at `searching` | axe on the photo view: it crashes Playwright's Firefox 159 page with axe-core 4.14.1 (the blocked-camera view is fine). Recorded as an annotation in the report. |
| WebKit | none: Playwright WebKit has no fake camera and cannot grant the permission, so `getUserMedia` is denied | the camera-granted test, and keyboard entry to a frame, because WebKit leaves buttons out of the Tab order unless a system setting is on |

A blocked camera is real in each engine: Chromium with no permission granted (`chromium-denied`), Firefox with `permissions.default.camera` set to block (`firefox-denied`), WebKit by default. The photo fallback runs through the same FaceLandmarker in every engine. The hidden-tab test sets `document.visibilityState` and fires `visibilitychange`, since headless browsers report every tab as visible.

```sh
node fixtures/build.mjs --source standin     # still.y4m and portrait.jpg in .cache/clips/standin
npx playwright install chromium firefox webkit
npm run e2e -- --project chromium --project chromium-denied --project chromium-desktop --project chromium-phone --project chromium-landscape
npm run e2e -- --project firefox --project firefox-denied --project webkit
```

`FACEFIT_STANDIN_DIR=<dir>` reads the clips from another checkout. `FACEFIT_CHROME=chrome` runs an installed Chrome instead of Playwright's Chromium.

## Registration gate

`node harness/baseline.mjs --source standin --gate` runs the stand-in's sweep conditions (`still`, `roll±5/10/15`, `dx±160/320`, `dy±120`, `zoom0.75/1.33`) on the CPU delegate and fails when a registration metric leaves its limit in `harness/gate.json`. CI runs it on every change. It forces the CPU delegate in every condition, so runner hardware without a GPU measures the same path, and it skips the guard self-test and the CPU fallback run. It writes results only with `--write`.

| Metric | Limit | Why |
|--------|-------|-----|
| `roll.renderedPerFaceDeg` | 0.9 to 1.1 | truth is 1; a mirrored roll gives -1 |
| `registration.gainX`, `gainY` | 0.9 to 1.1, 0.85 to 1.15 | truth is 1; gain y rests on the few unflagged samples of the two `dy` clips |
| `scale.still.renderedOverFace` | 0.95 to 1.15 | rendered frame width over face contour width |
| `scaleByProduct.product1.maxChangeFromStillPercent` | at most 8 | that ratio must not change with zoom |
| `solver.gatedShare` | at most 0.25 | share of samples where the app hid the overlay |
| core gated share (still, roll, dx) | at most 0.02 | these conditions are never gated on the stand-in |
| bridge offset over interocular distance | at most 0.12 | rendered bridge anchor against landmark 168 |

The limits come from the `standin-cpu` run in `results.json` (basis in `gate.json`). The stand-in's `zoom1.33` and `dy` clips are gated by the solver at most samples, which is why the overall gated share is not zero and the core share is gated separately. Timing metrics (`inferenceMs`, `pipelineMs`, rates) are not gated: runner hardware changes them without a code change.

## Bundle budget

`node perf/bundleBudget.mjs --dist ../frontend/dist` (`npm run bundle`) reports the raw, gzip and brotli size of the main JS, worker JS, CSS, WASM, WASM loader and face model in the production build, and exits 1 over a limit in `perf/budgets.json`. CI runs it after the frontend build. Any JS file outside the named classes counts against `otherJs`, whose budget is zero, so a new chunk fails until the budget is set on purpose. `--write --label <name>` records the sizes in `results.json` from a clean tree.

The JS and CSS budgets are the measured size plus 10 percent. The WASM, its loader and the model are pinned by SHA-256 in `frontend/scripts/vendor-mediapipe.mjs`, so their budget is the exact size.

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
