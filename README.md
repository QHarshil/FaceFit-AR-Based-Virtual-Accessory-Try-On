# FaceFit AR

Browser-based eyewear virtual try-on using MediaPipe Face Landmarker and Three.js. Runs entirely client-side with a containerized Node.js backend for product catalogue serving.

## Motivation

This project investigates lightweight facial landmark detection for consumer AR applications:

- **Landmark-based pose estimation**: MediaPipe Face Landmarker (478 landmarks) in place of custom CNN detectors, running in a Web Worker at camera rate.
- **Client-side geometry pipeline**: head pose from a PnP solve on 33 rigid face landmarks, with intrinsics estimated from an assumed field of view ([details](docs/geometry.md)).
- **Modular AR architecture** — Separates perception (MediaPipe), geometric reasoning (pose computation), and rendering (Three.js) into distinct pipeline stages.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │   Webcam     │ → │  MediaPipe   │ → │  Three.js Renderer   │ │
│  │   Stream     │   │  (worker)    │   │  (GLB overlay)       │ │
│  └──────────────┘   └──────────────┘   └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Node.js/Express)                     │
│         /api/products — eyewear catalogue (JSON)                │
└─────────────────────────────────────────────────────────────────┘
```

| Component | Implementation |
|-----------|----------------|
| Landmark detection | MediaPipe Tasks Vision `FaceLandmarker` in a module worker, self-hosted and pinned ([details](frontend/src/perception/README.md)) |
| Pose estimation | `solveHeadPose` from [`packages/cv`](packages/cv/README.md): EPnP, then Huber Levenberg-Marquardt with outlier rejection, against MediaPipe's canonical face; hidden when the reprojection error is high |
| Temporal filtering | One Euro filter on SE(3) over each solved pose, predicted at every render to the frame on screen, with MediaPipe's own landmark smoothing off. The sweep's rule picked an error-state Kalman filter, and the live run overrode it for its jitter and step overshoot ([details](docs/pose-filter.md)) |
| Depth/scale | Metric: depth in millimetres under the assumed FOV, models in millimetres |
| Rendering | Three.js camera with the projection of the camera intrinsics; the canvas renders at the video's size with the same `object-fit: cover` |
| Asset format | Normalized, meshopt-compressed GLBs with the origin on the bridge ([assets](assets/README.md)) |

## Performance

Measured numbers live in [`eval/results.json`](eval/results.json), produced by the scripts in [`eval/`](eval/README.md). Each run records the commit, hardware and sample size. Pose accuracy on AFLW2000-3D is in [`docs/pose-benchmark.md`](docs/pose-benchmark.md), pose filter jitter and lag in [`docs/pose-filter.md`](docs/pose-filter.md), and PD and face width from the iris in [`docs/metric-scale.md`](docs/metric-scale.md).

## Repository Structure

```
facefit-ar/
├── backend/
│   ├── Dockerfile
│   ├── server.js          # Express API
│   └── package.json
├── frontend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── components/
│   │   │   └── ARTryOn.tsx # Three.js scene and pose
│   │   └── pages/
│   │       ├── Home.tsx    # Product gallery
│   │       └── TryOn.tsx   # AR interface
│   └── public/models/     # GLBs copied from assets/out at build
├── docker-compose.yml
└── start.sh
```

## Running

### Docker (recommended)

```bash
./start.sh
# Frontend: http://localhost:3000
# API: http://localhost:5055
```

### Local Development

```bash
npm ci --prefix packages/contracts   # shared API schemas, used by both

# Terminal 1
cd backend && npm install && npm start

# Terminal 2
cd frontend && npm install && npm run dev   # http://localhost:3000
```

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Service status |
| `GET /api/products` | Eyewear catalogue |
| `GET /api/products/:id` | Single product |

## Technical Notes

- **State management**: An XState statechart runs the camera, worker, overlay and photo fallback, with a status and recovery for each state ([frontend/src/tryon](frontend/src/tryon/README.md)). Landmarks go to a pose store outside React; the render loop reads it each frame and React re-renders only on state changes.
- **Asset pipeline**: `assets/normalize.mjs` writes millimetre GLBs with the origin on the bridge, and the app seats that origin on the face model's nose bridge.
- **Browser requirements**: Camera API requires `https://` or `localhost`. Chromium-based browsers recommended.

## Extensions

- Custom landmark subsets for different accessory types (hats, earrings)
- Backend swap to database or external catalogue API without frontend changes

## License

MIT
