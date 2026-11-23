# FaceFit backend

TypeScript API for the product catalogue and client telemetry.

## Framework

Hono on Node. It is Web-standard (`Request`/`Response`), so routes are tested in process with `app.request`, and it has no runtime dependencies of its own.
Fastify was the alternative; its plugin system adds more than this API needs.

## Run

```sh
cd backend && npm ci
export DATABASE_URL=pglite://./.data/facefit   # Postgres in WASM, files in backend/.data
npm run migrate && npm run seed && npm run dev
```

With Docker: copy `.env.example` to `.env` at the repo root, set `POSTGRES_PASSWORD`, run `docker compose up --build`. The backend waits for Postgres, migrates, seeds from `assets/catalog.json`, then serves on 5055.

Checks: `npm run lint`, `format:check`, `typecheck`, `test`, `npm audit --audit-level=high`. Tests use PGlite, so they need no database service. Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and commit `drizzle/`.

## Environment

| Variable                   | Default  | Meaning                                                                                                                        |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`             | required | `postgres://...` or `pglite://<dir>` (persistent, shared by migrate, seed and the server). `pglite://memory` is for tests only |
| `PORT`                     | 5055     | Listen port                                                                                                                    |
| `CORS_ORIGINS`             | empty    | Comma-separated allowed origins. No wildcard.                                                                                  |
| `TRUST_PROXY`              | false    | Use the last `X-Forwarded-For` entry as the client key                                                                         |
| `RATE_LIMIT_WINDOW_MS`     | 60000    | Window length                                                                                                                  |
| `RATE_LIMIT_MAX`           | 120      | Requests per client per window                                                                                                 |
| `TELEMETRY_RATE_LIMIT_MAX` | 30       | Telemetry requests per client per window, on top of the general limit                                                          |
| `REQUEST_TIMEOUT_MS`       | 10000    | Handler timeout, answers 504                                                                                                   |
| `SHUTDOWN_TIMEOUT_MS`      | 10000    | Drain time after SIGTERM before sockets are cut                                                                                |

Rate limit counters live in process memory, so each replica counts separately.

## API

Errors are `{ "error": string, "requestId": string }`. Validation errors (400) add `issues: [{ path, message }]`. Unknown body fields and query parameters are rejected. Every response carries `X-Request-Id` and a CSP of `default-src 'none'`.

| Route                   | Success                      | Errors                               |
| ----------------------- | ---------------------------- | ------------------------------------ |
| `GET /api/health`       | 200 `{ status: "ok" }`       |                                      |
| `GET /api/ready`        | 200 `{ status: "ready" }`    | 503 database down or shutting down   |
| `GET /api/products`     | 200 array of products        | 503 database down                    |
| `GET /api/products/:id` | 200 product                  | 400 id not a positive int4, 404, 503 |
| `POST /api/telemetry`   | 202 `{ status: "accepted" }` | 400, 413 over 2 KiB                  |

All routes also return 429 with `Retry-After` over the rate limit.

Product: `id, slug, name, category, type, modelPath, description, dimensionsMm {total, lensWidth, lensHeight, bridge, templeLength}, dimensionsSource, bridgeOriginMm, anchors, attribution {author, authorUrl, sourceUrl, license, licenseUrl}`.

Telemetry body: `{ eventType, payload?, timestamp? }`.

- `eventType`: `catalogue_loaded`, `catalogue_failed`, `product_viewed`, `product_load_failed`, `camera_started`, `camera_error`, `tracking_state_changed`.
- `payload` keys: `count` (0 to 1000), `productId` (positive int or null), `faceDetected` (boolean), `errorCode` (`network`, `not_found`, `permission_denied`, `timeout`, `unsupported`, `unknown`).
- Events are logged as JSON without client address or user agent. Nothing is stored.

## CORS

Allowlisted origins get an exact `Access-Control-Allow-Origin` echo with `Allow-Credentials: true`, which lets `sendBeacon` succeed. Other origins get no CORS headers.
