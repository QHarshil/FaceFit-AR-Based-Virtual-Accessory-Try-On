# FaceFit AR

Browser-based eyewear virtual try-on using MediaPipe Face Mesh and Three.js. Runs entirely client-side with a containerized Node.js backend for product catalogue serving.

## Motivation

This project investigates lightweight facial landmark detection for consumer AR applications:

- **Landmark-based pose estimation** — Uses MediaPipe Face Mesh (468 landmarks) instead of custom CNN detectors, achieving real-time performance on commodity hardware without GPU inference.
- **Client-side geometry pipeline** — Computes head pose via classical linear algebra (orthonormal basis from eye/forehead vectors) rather than PnP solving, maintaining 60 FPS on laptop webcams.
- **Modular AR architecture** — Separates perception (MediaPipe), geometric reasoning (pose computation), and rendering (Three.js) into distinct pipeline stages.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │   Webcam     │ → │  MediaPipe   │ → │  Three.js Renderer   │ │
│  │   Stream     │   │  Face Mesh   │   │  (GLB overlay)       │ │
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
| Landmark detection | MediaPipe Face Mesh (`@mediapipe/face_mesh`), single-face mode, 0.5 confidence threshold |
| Pose estimation | Eye-to-eye vector (x-axis), forehead vector (approx. up), cross-product orthonormal basis |
| Depth/scale | Normalized MediaPipe z-estimates; inter-temple distance for proportional scaling |
| Rendering | Three.js with transparent WebGL canvas over `<video>` element |
| Asset format | GLB models, origin-centered at load time |

## Performance

Measured on 2023 MacBook (Chrome):

| Stage | Latency |
|-------|---------|
| MediaPipe inference | ~20-25 ms |
| Render loop | 60 FPS |
| End-to-end pose update | <40 ms |

Jitter mitigation: spatial averaging across landmark subsets (eyes, temples, nose bridge) and frame rejection when confidence drops below threshold.

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
│   │   │   └── ARTryOn.js # MediaPipe + Three.js pipeline
│   │   └── pages/
│   │       ├── Home.js    # Product gallery
│   │       └── TryOn.js   # AR interface
│   └── public/models/     # GLB eyewear assets
├── docker-compose.yml
└── start.sh
```

## Running

### Docker (recommended)

```bash
./start.sh
# Frontend: http://localhost:3000
# API: http://localhost:5000
```

### Local Development

```bash
# Terminal 1
cd backend && npm install && npm start

# Terminal 2
cd frontend && npm install && npm start
```

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Service status |
| `GET /api/products` | Eyewear catalogue |
| `GET /api/products/:id` | Single product |

## Technical Notes

- **State management**: MediaPipe callbacks write landmarks to a React ref, decoupling high-frequency perception updates from React's render cycle.
- **Asset pipeline**: GLB models are recentered and bounding-box normalized at load time for consistent placement across different eyewear geometries.
- **Browser requirements**: Camera API requires `https://` or `localhost`. Chromium-based browsers recommended.

## Extensions

- Kalman or exponential smoothing filters upstream of the renderer for additional jitter reduction
- Custom landmark subsets for different accessory types (hats, earrings)
- Backend swap to database or external catalogue API without frontend changes

## License

MIT
