# Perception

Camera frames go to a module worker running MediaPipe Tasks Vision `FaceLandmarker`; landmarks come back as a `LandmarkFrame` (`types.ts`). Only `landmarkerService.ts` and `landmarker.worker.ts` import MediaPipe.

| File                   | Role                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `frameSource.ts`       | `requestVideoFrameCallback` captures one `VideoFrame` per camera frame                                  |
| `frameScheduler.ts`    | One frame in flight; a newer frame replaces the waiting one                                             |
| `landmarkerClient.ts`  | Starts the worker, sends frames, maps replies to results or `PerceptionError`                           |
| `protocol.ts`          | Typed `init`, `frame`, `image`, `ready`, `result`, `imageResult` and `error` messages                   |
| `landmarkerService.ts` | `FaceLandmarker` in VIDEO or IMAGE mode, GPU delegate with CPU fallback, strictly increasing timestamps |
| `luminance.ts`         | Mean luma of a 32 by 18 copy of every 15th frame, for the try-on's low-light state                      |
| `sameOriginGuard.ts`   | Keeps the worker's network APIs on the app origin and reports blocked attempts                          |
| `faceSelection.ts`     | Picks the face the overlay follows when more than one is detected                                       |

The photo try-on (`tracking/photo.ts`) starts its own worker in IMAGE mode, sends one decoded photo as a transferred `ImageBitmap`, takes the largest face and stops the worker.

Frames cross as transferred `VideoFrame`s. A `VideoFrame` is created synchronously in the frame callback, wraps the decoded camera frame without a copy, and is closed explicitly; `createImageBitmap` is asynchronous and makes a copy. Closing matters: an open frame holds a camera buffer, so at most two exist at once.

`numFaces` is 2 (`NUM_FACES` in `landmarkerService.ts`). MediaPipe applies its built-in One Euro filter only when `numFaces` is 1, and runs the face detector on every frame where fewer than `numFaces` faces are tracked (`face_landmarker_graph.cc`, v1.2.3). With one face that filter delays slow motion before the pose filter sees it, so the app turns it off and leaves smoothing to the pose filter ([docs/pose-filter.md](../../../docs/pose-filter.md)). The overlay follows one face (`faceSelection.ts`). A track starts on the largest face, sized by the larger of the outer eye corner distance and the forehead to nose tip distance so that turning the head does not shrink it, and continues on the face nearest its last position and size in each frame. Size never moves the overlay to another face; that happens only after the tracked face has been missed for more than 15 frames. On the `two-face` clip, the stand-in portrait twice with the user rolling and moving beside a still bystander at 0.8 of its size, the overlay stayed on the user in all 241 pose samples and 483 renders, with both faces detected in every sample and one track id throughout (`runs["two-face"]` in [eval/results.json](../../../eval/results.json); Apple M4 Pro, HeadlessChrome 158, 8 s). `faceCount` in each landmark frame reports how many faces were detected, and `trackId` names the tracked face. A new `trackId` restarts the pose filter and drops the solver's warm start, so the overlay does not carry one face's motion to another. `VITE_NUM_FACES` at build time overrides the default; the eval harness uses that to measure one face.

## Self-hosted assets

`npm run vendor:mediapipe` runs before `dev`, `start` and `build`. It copies the module WASM pair from the installed package, downloads the model once, and checks every file against the size and SHA-256 pinned in `scripts/vendor-mediapipe.mjs`. Output goes to `public/mediapipe/` (not committed) and is served from the app origin.

| File                               | Served at                               | Bytes      | Source                                               | License                                                                                     |
| ---------------------------------- | --------------------------------------- | ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `vision_wasm_module_internal.js`   | `/mediapipe/tasks-vision/1.2.3/`        | 336,662    | `@mediapipe/tasks-vision` 1.2.3                      | Apache-2.0                                                                                  |
| `vision_wasm_module_internal.wasm` | `/mediapipe/tasks-vision/1.2.3/`        | 14,665,738 | `@mediapipe/tasks-vision` 1.2.3                      | Apache-2.0                                                                                  |
| `face_landmarker.task`             | `/mediapipe/face_landmarker/float16/1/` | 3,758,596  | `storage.googleapis.com/mediapipe-models`, float16/1 | Apache-2.0 ([model card](https://huggingface.co/litert-community/MediaPipe-FaceLandmarker)) |

`@mediapipe/tasks-vision` is pinned to 1.2.3, the latest stable release. 1.2.0 added Web Worker platform detection, 1.2.2 removed the non-SIMD builds, and 1.2.3 renamed APIs behind deprecated aliases; none of the calls used here changed. To upgrade, bump the package and the pins in the vendor script together.

## Errors

Failures surface as `PerceptionError` codes; `tracking/errorMessages.ts` maps them to the try-on error screen.

| Code          | Cause                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `model-fetch` | The model request failed, or the response is not a zip bundle (a missing file served as `index.html`)      |
| `wasm-fetch`  | A delegate failed to start, and the loader is not served as JavaScript or the binary lacks the WASM header |
| `unsupported` | Both delegates failed with the WASM reachable, or `requestVideoFrameCallback` or `VideoFrame` is missing   |
| `worker`      | The worker script failed to load or start, crashed, or sent a malformed message                            |
| `inference`   | `detectForVideo` threw; tracking stops                                                                     |

Without WebGL2 in workers the CPU delegate runs and `ready` reports it. Without WebGL at all the overlay cannot render, and `ARTryOn` reports that through `onError`.

## Privacy

Frames and landmarks stay in the browser. The package also posts usage logs to `odml.pa.googleapis.com` from the worker. The CSP (`csp.ts`) blocks that through `connect-src`. `sameOriginGuard.ts` blocks off-origin `fetch`, `XMLHttpRequest`, `importScripts` and `sendBeacon` inside the worker, so hosts that serve the files without the header are covered too, and reports each attempt to the main thread as a `blocked` message. The eval harness counts those attempts and fails a run that requests anything outside localhost.
