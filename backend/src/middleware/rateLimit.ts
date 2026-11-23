import type { MiddlewareHandler } from 'hono';
import { clientKey } from './clientKey.js';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  trustProxy: boolean;
  now?: () => number;
  maxTrackedClients?: number;
}

interface Window {
  count: number;
  resetAt: number;
}

// Fixed window counters in process memory. With several replicas each keeps its own count.
export const rateLimit = (options: RateLimitOptions): MiddlewareHandler => {
  const now = options.now ?? Date.now;
  const maxTracked = options.maxTrackedClients ?? 10_000;
  const windows = new Map<string, Window>();

  const sweep = (at: number): void => {
    for (const [key, window] of windows) {
      if (window.resetAt <= at) windows.delete(key);
    }
    // Insertion order puts the oldest windows first, so a flood of new keys cannot grow the map.
    for (const key of windows.keys()) {
      if (windows.size < maxTracked) break;
      windows.delete(key);
    }
  };

  return async (c, next) => {
    const at = now();
    const key = clientKey(c, options.trustProxy);
    let window = windows.get(key);
    if (!window || window.resetAt <= at) {
      if (windows.size >= maxTracked) sweep(at);
      window = { count: 0, resetAt: at + options.windowMs };
      windows.set(key, window);
    }
    window.count += 1;

    const remaining = Math.max(0, options.max - window.count);
    const resetSeconds = Math.ceil((window.resetAt - at) / 1_000);
    c.header('RateLimit-Limit', String(options.max));
    c.header('RateLimit-Remaining', String(remaining));
    c.header('RateLimit-Reset', String(resetSeconds));

    if (window.count > options.max) {
      c.header('Retry-After', String(resetSeconds));
      return c.json({ error: 'Too many requests' }, 429);
    }
    await next();
    return undefined;
  };
};
