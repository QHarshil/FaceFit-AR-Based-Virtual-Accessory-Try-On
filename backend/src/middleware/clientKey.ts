import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

// Behind one reverse proxy the last X-Forwarded-For entry is the address the proxy saw.
// Earlier entries are client-supplied and can be forged to dodge the rate limit.
export const clientKey = (c: Context, trustProxy: boolean): string => {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
};
