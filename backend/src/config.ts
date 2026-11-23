import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();

const origin = z.string().transform((value, ctx) => {
  try {
    const parsed = new URL(value);
    if (parsed.origin === 'null') throw new Error('not an origin');
    return parsed.origin;
  } catch {
    ctx.addIssue({ code: 'custom', message: `invalid origin: ${value}` });
    return z.NEVER;
  }
});

const originList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(origin));

const envSchema = z.object({
  PORT: positiveInt.default(5055),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: originList,
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  RATE_LIMIT_WINDOW_MS: positiveInt.default(60_000),
  RATE_LIMIT_MAX: positiveInt.default(120),
  TELEMETRY_RATE_LIMIT_MAX: positiveInt.default(30),
  REQUEST_TIMEOUT_MS: positiveInt.default(10_000),
  SHUTDOWN_TIMEOUT_MS: positiveInt.default(10_000),
});

export interface Config {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  trustProxy: boolean;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  telemetryRateLimitMax: number;
  requestTimeoutMs: number;
  shutdownTimeoutMs: number;
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = envSchema.parse(env);
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    corsOrigins: parsed.CORS_ORIGINS,
    trustProxy: parsed.TRUST_PROXY,
    rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    telemetryRateLimitMax: parsed.TELEMETRY_RATE_LIMIT_MAX,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    shutdownTimeoutMs: parsed.SHUTDOWN_TIMEOUT_MS,
  };
};
