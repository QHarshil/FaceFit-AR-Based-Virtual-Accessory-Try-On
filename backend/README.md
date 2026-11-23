# FaceFit backend

TypeScript API for the product catalogue and client telemetry.

## Framework

Hono on Node. It is Web-standard (`Request`/`Response`), so routes are tested in process with `app.request`, and it has no runtime dependencies of its own.
Fastify was the alternative; its plugin system adds more than this API needs.
