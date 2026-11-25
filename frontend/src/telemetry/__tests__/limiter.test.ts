import { describe, expect, it } from 'vitest';
import { createTelemetryLimiter, DEFAULT_LIMITS } from '../limiter';

describe('createTelemetryLimiter', () => {
  it('drops an identical event inside the dedupe window and allows it after', () => {
    const limiter = createTelemetryLimiter({
      maxPerWindow: 10,
      windowMs: 60_000,
      dedupeMs: 30_000,
    });
    expect(limiter.admit('face:true', 0)).toBe(true);
    expect(limiter.admit('face:true', 29_999)).toBe(false);
    expect(limiter.admit('face:false', 29_999)).toBe(true);
    expect(limiter.admit('face:true', 30_000)).toBe(true);
  });

  it('caps events per rolling window', () => {
    const limiter = createTelemetryLimiter({ maxPerWindow: 3, windowMs: 60_000, dedupeMs: 0 });
    expect([0, 1, 2, 3].map((i) => limiter.admit(`event-${i}`, i * 1_000))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    // The first event leaves the window at 60 s.
    expect(limiter.admit('event-4', 59_999)).toBe(false);
    expect(limiter.admit('event-5', 60_000)).toBe(true);
  });

  it('keeps a minute of face found and lost flapping under the backend limit of 30', () => {
    const limiter = createTelemetryLimiter(DEFAULT_LIMITS);
    let sent = 0;
    for (let t = 0; t < 60_000; t += 500) {
      if (limiter.admit(`face:${(t / 500) % 2 === 0}`, t)) sent += 1;
    }
    expect(sent).toBeLessThanOrEqual(4);
  });

  it('keeps one tab under half the backend limit whatever it sends', () => {
    const limiter = createTelemetryLimiter(DEFAULT_LIMITS);
    let sent = 0;
    for (let i = 0; i < 1_000; i += 1) if (limiter.admit(`distinct-${i}`, i * 50)) sent += 1;
    expect(sent).toBeLessThanOrEqual(15);
  });
});
