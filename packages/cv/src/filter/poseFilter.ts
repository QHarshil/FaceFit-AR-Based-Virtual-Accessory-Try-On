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
   * clamped to the range from the last update to `maxPredictionMs` after it,
   * so past that horizon the pose holds. Null before the first update, after
   * a reset, and more than `maxStaleMs` after the last update.
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
  /** Longest time after the last update that `predict` returns a pose. */
  readonly maxStaleMs?: number;
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

/**
 * One second. A worker slower than `maxGapMs` restarts the filter on every
 * pose, so the held pose is the last one solved, and with one frame waiting
 * behind the one in flight a render can see it up to about two inference
 * times old. This keeps a worker of up to about 450 ms per frame on screen and
 * hides a pose old enough that the head has likely moved away from it, as
 * after a hidden tab or a stalled worker.
 */
export const DEFAULT_MAX_STALE_MS = 1000;

export interface ResolvedTiming {
  readonly maxGapMs: number;
  readonly maxPredictionMs: number;
  readonly maxStaleMs: number;
}

export function resolveTiming(timing: PoseFilterTiming): ResolvedTiming {
  const maxGapMs = timing.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  const maxPredictionMs = timing.maxPredictionMs ?? DEFAULT_MAX_PREDICTION_MS;
  const maxStaleMs = timing.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
  if (!(maxGapMs > 0) || !(maxPredictionMs >= 0) || !(maxStaleMs >= 0)) {
    throw new RangeError('maxGapMs must be positive, maxPredictionMs and maxStaleMs non-negative');
  }
  return { maxGapMs, maxPredictionMs, maxStaleMs };
}

/** Whether an update at `timestampMs` continues the sequence that last updated at `lastMs`. */
export function continuesSequence(lastMs: number | null, timestampMs: number, maxGapMs: number): boolean {
  return lastMs !== null && timestampMs > lastMs && timestampMs - lastMs <= maxGapMs;
}

/**
 * Prediction horizon in seconds, clamped to [0, maxPredictionMs]; 0 for a NaN
 * time. The clamp holds the pose a render drew at the cap, so a stalled
 * worker does not send the overlay along the last velocity, and a worker
 * slower than maxGapMs, whose updates each restart the filter at zero
 * velocity, keeps its last pose on screen. Null more than maxStaleMs after
 * the last update.
 */
export function horizonSeconds(lastMs: number, timestampMs: number, timing: ResolvedTiming): number | null {
  const aheadMs = timestampMs - lastMs;
  if (Number.isNaN(aheadMs)) return 0;
  if (aheadMs > timing.maxStaleMs) return null;
  return Math.min(Math.max(aheadMs, 0), timing.maxPredictionMs) / 1000;
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
