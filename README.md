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
| Temporal filtering | Error-state Kalman filter on SE(3) over each solved pose, predicted at every render to the frame on screen; chosen over a One Euro filter by a measured sweep, with MediaPipe's own landmark smoothing off ([details](docs/pose-filter.md)) |
| Depth/scale | Metric: depth in millimetres under the assumed FOV, models in millimetres |
| Rendering | Three.js camera with the projection of the camera intrinsics; the canvas renders at the video's size with the same `object-fit: cover` |
| Asset format | Normalized, meshopt-compressed GLBs with the origin on the bridge ([assets](assets/README.md)) |

## Performance

Measured numbers live in [`eval/results.json`](eval/results.json), produced by the scripts in [`eval/`](eval/README.md). Each run records the commit, hardware and sample size. Pose accuracy on AFLW2000-3D is in [`docs/pose-benchmark.md`](docs/pose-benchmark.md). Pose filter jitter and lag are in [`docs/pose-filter.md`](docs/pose-filter.md).

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

- **State management**: Landmarks arrive from the worker and update the Three.js scene through a ref, decoupling high-frequency perception updates from React's render cycle.
- **Asset pipeline**: `assets/normalize.mjs` writes millimetre GLBs with the origin on the bridge, and the app seats that origin on the face model's nose bridge.
- **Browser requirements**: Camera API requires `https://` or `localhost`. Chromium-based browsers recommended.

## Extensions

- Custom landmark subsets for different accessory types (hats, earrings)
- Backend swap to database or external catalogue API without frontend changes

## License

MIT
