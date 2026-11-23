import type { MiddlewareHandler } from 'hono';

const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, X-Request-Id';
const PREFLIGHT_MAX_AGE_SECONDS = '600';

// Allowlisted origins get an exact echo with credentials. Other origins get no CORS headers,
// so the browser blocks the read. The wildcard is never used because it cannot carry credentials.
export const cors = (allowedOrigins: readonly string[]): MiddlewareHandler => {
  const allowed = new Set(allowedOrigins);

  return async (c, next) => {
    const origin = c.req.header('origin');
    const permitted = origin !== undefined && allowed.has(origin);
    c.header('Vary', 'Origin', { append: true });

    if (c.req.method === 'OPTIONS' && permitted) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Allow-Methods', ALLOWED_METHODS);
      c.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      c.header('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_SECONDS);
    }

    // Preflights continue down the chain so the rate limiter counts them.
    await next();
    if (permitted && c.req.method !== 'OPTIONS') {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Expose-Headers', 'X-Request-Id, RateLimit-Remaining, Retry-After');
    }
    return undefined;
  };
};
