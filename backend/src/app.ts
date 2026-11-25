import { randomUUID } from 'node:crypto';
import { MAX_TELEMETRY_BYTES, noQuery, productIdParam, telemetryBody } from '@facefit/contracts';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { timeout } from 'hono/timeout';
import type { ZodType, z } from 'zod';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { productRepository, type Product } from './db/products.js';
import type { Logger } from './logger.js';
import { cors } from './middleware/cors.js';
import { rateLimit } from './middleware/rateLimit.js';

export type AppConfig = Pick<
  Config,
  | 'corsOrigins'
  | 'trustProxy'
  | 'rateLimitWindowMs'
  | 'rateLimitMax'
  | 'telemetryRateLimitMax'
  | 'requestTimeoutMs'
>;

export interface AppDeps {
  config: AppConfig;
  database: Database;
  logger: Logger;
  isShuttingDown?: () => boolean;
}

interface Env {
  Variables: { requestId: string };
}

const MAX_LOGGED_PATH = 200;
const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;
const PRODUCTS_CACHE = 'public, max-age=60';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

const productResponse = (product: Product) => ({
  id: product.id,
  slug: product.slug,
  name: product.name,
  category: product.category,
  type: product.type,
  modelPath: product.modelPath,
  description: product.description,
  dimensionsMm: product.dimensionsMm,
  dimensionsSource: product.dimensionsSource,
  bridgeOriginMm: product.bridgeOriginMm,
  anchors: product.anchors,
  attribution: product.attribution,
});

class DatabaseUnavailableError extends Error {
  override readonly name = 'DatabaseUnavailableError';
}

const databaseCall = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch {
    throw new DatabaseUnavailableError('database call failed');
  }
};

class ValidationError extends Error {
  override readonly name = 'ValidationError';
  constructor(readonly issues: { path: string; message: string }[]) {
    super('validation failed');
  }
}

const parseInput = <Schema extends ZodType>(schema: Schema, input: unknown): z.output<Schema> => {
  const outcome = schema.safeParse(input);
  if (outcome.success) return outcome.data;
  throw new ValidationError(
    outcome.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  );
};

const readJsonBody = async (c: Context<Env>): Promise<unknown> => {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError([{ path: '', message: 'Body must be valid JSON' }]);
  }
};

export const createApp = ({ config, database, logger, isShuttingDown }: AppDeps): Hono<Env> => {
  const app = new Hono<Env>();
  const products = productRepository(database.db);

  app.use(async (c, next) => {
    const supplied = c.req.header('x-request-id');
    const requestId = supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    const started = performance.now();
    await next();
    // The client address and user agent are left out on purpose.
    logger.info('request', {
      requestId,
      method: c.req.method,
      path: c.req.path.slice(0, MAX_LOGGED_PATH),
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    });
  });

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
      crossOriginResourcePolicy: 'cross-origin',
      referrerPolicy: 'no-referrer',
      xFrameOptions: 'DENY',
    }),
  );
  app.use(cors(config.corsOrigins));
  // Every path and method counts, including preflights and unknown routes.
  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMax,
      trustProxy: config.trustProxy,
    }),
  );

  // A cross-origin write that skips preflight (a simple request) would otherwise be accepted.
  const allowedOrigins = new Set(config.corsOrigins);
  app.use(async (c, next) => {
    const origin = c.req.header('origin');
    if (origin !== undefined && c.req.method !== 'OPTIONS' && !allowedOrigins.has(origin)) {
      return c.json({ error: 'Origin not allowed', requestId: c.get('requestId') }, 403);
    }
    await next();
    return undefined;
  });

  app.use('/api/*', timeout(config.requestTimeoutMs));
  app.options('*', (c) => c.body(null, 204));

  app.get('/api/health', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'ok' });
  });

  app.get('/api/ready', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (isShuttingDown?.()) return c.json({ status: 'shutting_down' }, 503);
    try {
      await database.ping();
      return c.json({ status: 'ready' });
    } catch (error) {
      logger.error('database ping failed', {
        requestId: c.get('requestId'),
        error: error instanceof Error ? error.name : 'unknown',
      });
      return c.json({ status: 'unavailable' }, 503);
    }
  });

  app.get('/api/products', async (c) => {
    parseInput(noQuery, c.req.query());
    c.header('Cache-Control', PRODUCTS_CACHE);
    const rows = await databaseCall(() => products.list());
    return c.json(rows.map(productResponse));
  });

  app.get('/api/products/:id', async (c) => {
    const { id } = parseInput(productIdParam, c.req.param());
    parseInput(noQuery, c.req.query());
    const product = await databaseCall(() => products.find(id));
    if (!product) return c.json({ error: 'Product not found', requestId: c.get('requestId') }, 404);
    c.header('Cache-Control', PRODUCTS_CACHE);
    return c.json(productResponse(product));
  });

  app.post(
    '/api/telemetry',
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.telemetryRateLimitMax,
      trustProxy: config.trustProxy,
    }),
    async (c, next) => {
      if (!JSON_CONTENT_TYPE.test(c.req.header('content-type') ?? '')) {
        return c.json(
          { error: 'Content-Type must be application/json', requestId: c.get('requestId') },
          415,
        );
      }
      await next();
      return undefined;
    },
    bodyLimit({
      maxSize: MAX_TELEMETRY_BYTES,
      onError: () => {
        throw new HTTPException(413, { message: 'Payload too large' });
      },
    }),
    async (c) => {
      parseInput(noQuery, c.req.query());
      const event = parseInput(telemetryBody, await readJsonBody(c));
      logger.info('telemetry', {
        requestId: c.get('requestId'),
        eventType: event.eventType,
        payload: event.payload,
      });
      c.header('Cache-Control', 'no-store');
      return c.json({ status: 'accepted' }, 202);
    },
  );

  app.notFound((c) => c.json({ error: 'Not found', requestId: c.get('requestId') }, 404));

  app.onError((error, c) => {
    const requestId = c.get('requestId');
    if (error instanceof ValidationError) {
      return c.json({ error: 'Validation failed', issues: error.issues, requestId }, 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ error: error.message || 'Request failed', requestId }, error.status);
    }
    // Only the error class is logged. Driver messages can carry connection details.
    logger.error('request failed', { requestId, error: error.name });
    if (error instanceof DatabaseUnavailableError) {
      return c.json({ error: 'Service unavailable', requestId }, 503);
    }
    return c.json({ error: 'Internal server error', requestId }, 500);
  });

  return app;
};
