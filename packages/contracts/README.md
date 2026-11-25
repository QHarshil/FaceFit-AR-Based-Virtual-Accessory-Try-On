# @facefit/contracts

Zod schemas for the API: product responses, request parameters and telemetry events. The backend validates requests with them; the frontend parses responses with them and builds telemetry from the inferred types.

- Frontend: bundled from `src/` through a Vite alias, type-checked against `dist/*.d.ts` from `npm run contracts:build` (same arrangement as `packages/cv`).
- Backend: a `file:` dependency, compiled to `dist/` by `npm run contracts:build` before its own build, tests and type checks.
- Both consumers compile with their own TypeScript and read zod from this package's `node_modules`, so run `npm ci` here first (`--omit=dev` is enough for a consumer).

```sh
npm ci && npm run typecheck && npm test
```
