// Client-side budget for telemetry. The backend accepts 30 events per minute
// per client and answers the rest with 429, so the client stays well under it
// and drops repeats of an event it just sent.

export interface TelemetryLimiterOptions {
  /** Events allowed in any rolling window. */
  maxPerWindow: number;
  windowMs: number;
  /** An event identical to one sent this recently is dropped. */
  dedupeMs: number;
}

export interface TelemetryLimiter {
  /** True when an event with this key may be sent at `nowMs`; records it if so. */
  admit(key: string, nowMs: number): boolean;
}

export const DEFAULT_LIMITS: TelemetryLimiterOptions = {
  // Half the backend's per-minute limit, leaving room for a second tab.
  maxPerWindow: 15,
  windowMs: 60_000,
  // Face found and lost alternate quickly while someone moves in and out of
  // view; one report of each per half minute is enough.
  dedupeMs: 30_000,
};

export const createTelemetryLimiter = ({
  maxPerWindow,
  windowMs,
  dedupeMs,
}: TelemetryLimiterOptions = DEFAULT_LIMITS): TelemetryLimiter => {
  const sentAt: number[] = [];
  const lastSentByKey = new Map<string, number>();

  return {
    admit(key, nowMs) {
      const last = lastSentByKey.get(key);
      if (last !== undefined && nowMs - last < dedupeMs) return false;
      while (sentAt.length > 0 && nowMs - (sentAt[0] as number) >= windowMs) sentAt.shift();
      if (sentAt.length >= maxPerWindow) return false;
      sentAt.push(nowMs);
      lastSentByKey.set(key, nowMs);
      for (const [other, at] of lastSentByKey) {
        if (nowMs - at >= dedupeMs) lastSentByKey.delete(other);
      }
      return true;
    },
  };
};
