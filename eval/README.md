# Eval harness

Replays clips through the try-on page in Chrome as a fake camera and writes metrics to `results.json`. The app reports timings and poses through `probe()` (`frontend/src/utils/probe.js`), which is a no-op unless the harness installs a sink.

## Run

Requires ffmpeg and Google Chrome.

```sh
cd eval && npm install
fixtures/record.sh static 12 && fixtures/record.sh blink 12   # webcam clips, macOS
node fixtures/build.mjs --source recordings                   # Y4M clips in .cache/ (about 2 GB)
node harness/baseline.mjs --source recordings                 # refuses a dirty working tree
npm test
```

## Conditions

| Id | Input | Measured |
|----|-------|----------|
| `still` | first frame of `static.mp4` with temporal noise | 10 s |
| `roll±5/10/15` | still frame rotated by a known angle | 3 s each |
| `dx±160/320`, `dy±120` | still frame shifted by known output pixels | 3 s each |
| `zoom0.75`, `zoom1.33` | still frame scaled | 3 s each |
| `product2` to `product4` | `still` clip with the other catalog models | 3 s each |
| `rec-static`, `rec-blink` | recordings as captured | 10 s each |

## Metrics

| Metric | Definition | Correct value |
|--------|------------|---------------|
| `inferenceMs` | `FaceMesh.send` duration, including the results callback | lower |
| `pipelineMs` | frame pickup to the end of the first render with the new pose; excludes camera and display latency | lower |
| jitter `rmsHighPass` | RMS distance from a 9-sample centered moving average, blinks masked | lower |
| `renderedPerFaceDeg` | slope of the rendered frame's screen angle against the face's eye-line angle | 1 |
| `gainX`, `gainY` | slope of overlay displacement against nose-bridge displacement | 1 |
| `renderedOverFace` | rendered frame width over face contour width (landmarks 234 to 454) | constant across zoom |
| blink shift | peak vertical displacement during a blink against the open-eye median before it | 0 |

Screen quantities are CSS pixels at a 1280x720 viewport.
