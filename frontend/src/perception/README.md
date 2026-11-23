# Perception

Camera frames go to a module worker running MediaPipe Tasks Vision `FaceLandmarker`; landmarks come back as a `LandmarkFrame` (`types.ts`). Only `landmarkerService.ts` and `landmarker.worker.ts` import MediaPipe.

| File                   | Role                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `frameSource.ts`       | `requestVideoFrameCallback` captures one `VideoFrame` per camera frame                         |
| `frameScheduler.ts`    | One frame in flight; a newer frame replaces the waiting one                                    |
| `landmarkerClient.ts`  | Starts the worker, sends frames, maps replies to results or `PerceptionError`                  |
| `protocol.ts`          | Typed `init`, `frame`, `ready`, `result` and `error` messages                                  |
| `landmarkerService.ts` | `FaceLandmarker` in VIDEO mode, GPU delegate with CPU fallback, strictly increasing timestamps |

Frames cross as transferred `VideoFrame`s. A `VideoFrame` is created synchronously in the frame callback, wraps the decoded camera frame without a copy, and is closed explicitly; `createImageBitmap` is asynchronous and makes a copy. Closing matters: an open frame holds a camera buffer, so at most two exist at once.

`numFaces` is 2 so a second person can be reported. MediaPipe applies its built-in One Euro filter only when `numFaces` is 1, and runs the face detector on every frame where fewer than `numFaces` faces are tracked (`face_landmarker_graph.cc`, v1.2.3).

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

| Code          | Cause                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `model-fetch` | The model request failed                                                                                 |
| `wasm-fetch`  | A delegate failed to start and the WASM files are unreachable                                            |
| `unsupported` | Both delegates failed with the WASM reachable, or `requestVideoFrameCallback` or `VideoFrame` is missing |
| `worker`      | The worker script failed to load or start, crashed, or sent a malformed message                          |
| `inference`   | `detectForVideo` threw; tracking stops                                                                   |

Without WebGL2 in workers the CPU delegate runs and `ready` reports it. Without WebGL at all the overlay cannot render, and `ARTryOn` reports that through `onError`.

## Privacy

Frames and landmarks stay in the browser. The package also posts usage logs to `odml.pa.googleapis.com` from the worker. The CSP (`csp.ts`) blocks that through `connect-src`, and `sameOriginFetch.ts` rejects any off-origin fetch inside the worker for hosts that serve the files without the header. The eval harness fails a run that requests anything outside localhost.
