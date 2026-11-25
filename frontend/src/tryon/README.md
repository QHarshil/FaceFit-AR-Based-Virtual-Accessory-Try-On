# Try-on statechart

`machine.ts` is an XState v5 machine built with typed `setup`. XState was chosen over a hand-written reducer because the camera, the worker, the product request and the photo detection are invoked actors: leaving a state stops its actor, so a late camera stream or worker reply from an earlier attempt cannot reach the page.

## States

- `product`: `loading`, `notFound` (bad or unknown id), `unavailable` (network, timeout or server error; retry).
- `session.overlay`: `loading` (GLB), `ready`, `failed` (GLB failed or the overlay crashed; retry), `noWebgl` (retry), `contextLost` (reload). The GLB keeps loading while the context is lost, so `contextLost` has `modelLoaded` and `modelLoading`, and a restore returns to `ready` or `loading`.
- `session.source.live`, three parallel regions:
  - `visibility`: `visible`, `hidden`.
  - `camera`: `active` (`requesting`, `streaming`, `paused`), `denied`, `missing`, `busy`, `unsupported`, `failed`, `ended`. `missing` and `ended` retry on a device change; `ended` also retries when the page is shown again.
  - `perception`: `active` (`loading`, `running`, `paused`), `restarting`, `failed` (`modelFetch`, `wasmFetch`, `unsupported`, `captureUnsupported`, `crashed`). A crashed worker restarts after `PERCEPTION_RESTART_DELAY_MS`, at most `MAX_PERCEPTION_RESTARTS` times, then waits for the user.
  - `running` holds the face states: `searching`, `tracking`, `multiple`, `lowLight`, `lost`. They come from `faceStatus.ts`, which debounces the worker's face counts and frame brightness. Low light is a mean luma below 40 of 255 on two samples in a row, reported only while no face is tracked. The threshold of 40 is chosen, not measured against low-light footage.
- `session.source.photo`: `choosing`, `detecting`, `showing`, `noFace`, `failed`.

A hidden page moves `camera` and `perception` to `paused`, which stops the camera track, so the browser's camera indicator goes off, and stops sending frames. Showing the page asks for the same camera again from `requesting`; a refusal or a missing device ends in `denied` or `missing`.

## Status

`status.ts` picks one status from the parallel regions by priority (a lost WebGL context outranks tracking) and gives each its text, screen reader announcement and recovery actions. `withPose` adds `faceTurned` from the pose stream when the overlay is hidden while the face is in view.

## Tests

`__tests__/machine.test.ts` has one test per edge and fails if the machine gains an edge without one. `__tests__/status.test.ts` reaches every status, and `components/__tests__/StatusPanel.test.tsx` renders each.
