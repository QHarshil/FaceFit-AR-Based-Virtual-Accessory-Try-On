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
  DATABASE_URL: z.string().min(1).optional(),
  POSTGRES_HOST: z.string().min(1).optional(),
  POSTGRES_PORT: positiveInt.default(5432),
  POSTGRES_USER: z.string().min(1).optional(),
  POSTGRES_PASSWORD: z.string().min(1).optional(),
  POSTGRES_DB: z.string().min(1).optional(),
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

type ParsedEnv = z.output<typeof envSchema>;

// Separate variables let compose pass a password with characters that are not valid in a URL.
const resolveDatabaseUrl = (parsed: ParsedEnv): string => {
  if (parsed.DATABASE_URL) return parsed.DATABASE_URL;
  const { POSTGRES_HOST: host, POSTGRES_USER: user, POSTGRES_PASSWORD: password } = parsed;
  const database = parsed.POSTGRES_DB;
  if (!host || !user || !password || !database) {
    throw new Error(
      'Set DATABASE_URL, or POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB',
    );
  }
  const credentials = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `postgres://${credentials}@${host}:${String(parsed.POSTGRES_PORT)}/${encodeURIComponent(database)}`;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = envSchema.parse(env);
  return {
    port: parsed.PORT,
    databaseUrl: resolveDatabaseUrl(parsed),
    corsOrigins: parsed.CORS_ORIGINS,
    trustProxy: parsed.TRUST_PROXY,
    rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    telemetryRateLimitMax: parsed.TELEMETRY_RATE_LIMIT_MAX,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    shutdownTimeoutMs: parsed.SHUTDOWN_TIMEOUT_MS,
  };
};
