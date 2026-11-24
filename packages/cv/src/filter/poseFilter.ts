import type { HeadPose } from '../pnp.ts';

/**
 * Temporal filter over a stream of head poses. Timestamps are milliseconds on
 * one monotonic clock; the gap between updates may vary.
 */
export interface PoseFilter {
  /**
   * Adds a pose measured at `timestampMs` and returns the filtered pose at
   * that time. A gap above `maxGapMs` since the last update, or a timestamp at
   * or before it, restarts the filter from this pose.
   */
  update(pose: HeadPose, timestampMs: number): HeadPose;
  /**
   * The filtered pose extrapolated at constant velocity to `timestampMs`,
   * clamped to the range from the last update to `maxPredictionMs` after it.
   * Null before the first update and after a reset.
   */
  predict(timestampMs: number): HeadPose | null;
  /** Forgets the state, for example when the face is lost. */
  reset(): void;
}

export interface PoseFilterTiming {
  /**
   * Longest gap between updates the state survives. Past it the velocity
   * estimate is stale, so the filter restarts from the next pose.
   */
  readonly maxGapMs?: number;
  /** Furthest `predict` extrapolates past the last update. */
  readonly maxPredictionMs?: number;
}

/**
 * Six frames at 30 Hz. A constant-velocity extrapolation over longer than that
 * misses a head that turned or stopped in between, and restarting from the raw
 * pose has no lag.
 */
export const DEFAULT_MAX_GAP_MS = 200;

/**
 * Three frames at 30 Hz. In normal use the horizon is at most one inference
 * interval; the cap keeps a stalled worker from sending the overlay off along
 * the last velocity.
 */
export const DEFAULT_MAX_PREDICTION_MS = 100;

export interface ResolvedTiming {
  readonly maxGapMs: number;
  readonly maxPredictionMs: number;
}

export function resolveTiming(timing: PoseFilterTiming): ResolvedTiming {
  const maxGapMs = timing.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  const maxPredictionMs = timing.maxPredictionMs ?? DEFAULT_MAX_PREDICTION_MS;
  if (!(maxGapMs > 0) || !(maxPredictionMs >= 0)) {
    throw new RangeError('maxGapMs must be positive and maxPredictionMs non-negative');
  }
  return { maxGapMs, maxPredictionMs };
}

/** Whether an update at `timestampMs` continues the sequence that last updated at `lastMs`. */
export function continuesSequence(lastMs: number | null, timestampMs: number, maxGapMs: number): boolean {
  return lastMs !== null && timestampMs > lastMs && timestampMs - lastMs <= maxGapMs;
}

/** Prediction horizon in seconds, clamped to [0, maxPredictionMs]; 0 for a non-finite time. */
export function horizonSeconds(lastMs: number, timestampMs: number, maxPredictionMs: number): number {
  const aheadMs = timestampMs - lastMs;
  if (!Number.isFinite(aheadMs)) return 0;
  return Math.min(Math.max(aheadMs, 0), maxPredictionMs) / 1000;
}

/** Rejects input the filter state could not recover from. */
export function assertFinitePose(pose: HeadPose, timestampMs: number): void {
  if (
    !Number.isFinite(timestampMs) ||
    !pose.rotation.every(Number.isFinite) ||
    !pose.translationMm.every(Number.isFinite)
  ) {
    throw new RangeError('pose filter input must be finite');
  }
}
