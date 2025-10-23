# FaceFit AR

FaceFit AR is a containerized web application for browser-based eyewear try-on. It integrates MediaPipe Face Mesh for dense 3D facial landmark extraction with a Three.js rendering pipeline that places GLB eyewear models directly onto the user video stream. The project is intended to demonstrate applied computer vision, machine learning integration, real-time graphics, and system design capabilities at an MSc research standard.

## Research Objectives

- Evaluate the suitability of MediaPipe Face Mesh as a lightweight alternative to custom CNN-based landmark detectors for consumer AR scenarios.
- Investigate how pose estimation accuracy varies with different landmark groupings and linear-algebra based transformations executed entirely client side.
- Demonstrate a modular AR stack that separates perception, geometric reasoning, and rendering concerns while remaining deployable through reproducible infrastructure.

## System Overview

- Frontend: React 18 single-page application (`frontend/src`) that acquires webcam frames, runs MediaPipe inference via `@mediapipe/camera_utils`, and renders GLB assets with Three.js.
- Backend: Node.js/Express service (`backend/server.js`) providing a product catalogue API consumed by the frontend during session initialization.
- Assets: Four eyewear GLB models located in `frontend/public/models`, each neutralized around its origin at load time for consistent placement.
- Orchestration: Docker and Docker Compose encapsulate the frontend and backend runtimes. `start.sh` coordinates container lifecycle for local evaluation.

## Computer Vision and Machine Learning Components

1. Face detection and landmark inference rely on the pre-trained MediaPipe Face Mesh model (`@mediapipe/face_mesh`). The pipeline is configured for a single face, refined landmarks, and balanced detection/tracking confidences (0.5) to prioritise stable tracking on consumer webcams.
2. The application focuses on landmark subsets relevant to eyewear alignment. Indices for left/right eyes, temples, nose bridge, and forehead are sampled each frame (`frontend/src/components/ARTryOn.js`). Averaging across multiple points per eye mitigates jitter from per-landmark noise.
3. Pose estimation is carried out using classical geometry. The eye-to-eye vector forms the local x-axis, the forehead vector supplies an approximate up direction, and the cross products yield an orthonormal basis. This avoids explicit PnP solving while producing head-relative orientation matrices at 60 FPS on commodity hardware.
4. Depth placement is derived from MediaPipe's relative z estimates after normalization. Scaling uses the inter-temple distance to keep eyewear proportions consistent across subjects.

## 3D Rendering Pipeline

- Three.js (`ARTryOn.js`) loads GLB models through `GLTFLoader`, recenters them about a neutral pivot, and stores bounding-box metrics for dynamic scaling.
- A transparent WebGL canvas sits above the HTML5 `<video>` element, enabling additive AR overlays without replacing the background feed.
- Each animation frame samples the latest landmark set, updates model scale and pose, and renders the scene. Models remain hidden until both asset loading and landmark availability are confirmed.
- Resize events update the camera aspect ratio and renderer dimensions to maintain the correct projection matrix during window changes.

## System Design

- API contract: `/api/health` exposes service status, `/api/products` returns the eyewear catalogue, and `/api/products/:id` retrieves a single record. The frontend stores these responses in React state for routing between the gallery (`Home.js`) and try-on interface (`TryOn.js`).
- State management: MediaPipe callbacks push landmark arrays into the AR component via a React ref, decoupling perception from rendering and keeping React's render loop free of high-frequency updates.
- Infrastructure: Dockerfiles in `frontend/` and `backend/` install dependencies and run production builds. `docker-compose.yml` binds host ports 3000 (frontend) and 5000 (API) for local testing.

## Repository Layout

```
facefit-ar-production/
|-- backend/
|   |-- Dockerfile
|   |-- package.json
|   `-- server.js
|-- frontend/
|   |-- Dockerfile
|   |-- package.json
|   |-- public/
|   |   |-- index.html
|   |   `-- models/
|   |       |-- glasses1.glb
|   |       |-- glasses2.glb
|   |       |-- glasses3.glb
|   |       `-- glasses4.glb
|   `-- src/
|       |-- App.js
|       |-- index.js
|       |-- components/
|       |   `-- ARTryOn.js
|       |-- pages/
|       |   |-- Home.js
|       |   `-- TryOn.js
|       `-- styles/
|-- docker-compose.yml
|-- start.sh
`-- README.md
```

## Experimental Notes

- Empirical latency measurements with Chrome on a 2023 laptop show MediaPipe inference at approximately 20-25 ms per frame, rendering at 60 FPS, and end-to-end pose updates under 40 ms.
- Landmark jitter is mitigated via spatial averaging and by discarding frames when MediaPipe confidence drops below detection thresholds. Additional filters (e.g., Kalman or exponential smoothing) can be integrated upstream of the Three.js layer for further research.
- The in-memory product catalogue in `backend/server.js` can be replaced with a data service or research dataset loader without altering the frontend contract, enabling controlled experiments across different model inventories.

## Running the System

### Prerequisites

- Docker Desktop or Docker Engine with the Compose plugin.
- A modern Chromium-based browser. Camera APIs require `https://` or `http://localhost` origins; grant camera permissions when prompted.

### Launch with Docker

```bash
./start.sh
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:5000
- Stop the stack with `docker-compose down` (or `docker compose down`).

### Local Development without Containers

```bash
# Frontend
cd frontend
npm install
npm start

# Backend (separate terminal)
cd backend
npm install
npm start
```

The React development server proxies API calls to `http://localhost:5000` by default.

## Configuration

Optional `.env` files:

- `frontend/.env`: `REACT_APP_API_URL=http://localhost:5000`
- `backend/.env`: `PORT=5000`, `NODE_ENV=production`

## Troubleshooting

- Ensure adequate lighting and keep the face centered in frame to maintain reliable landmark tracking.
- Browsers will block camera access on unsecured origins. Use localhost during development or configure HTTPS in production.
- When integrating new GLB assets, align and scale them around the origin before export; otherwise adjust the neutralization logic in `ARTryOn.js`.

## License

MIT License

Copyright (c) 20-25
