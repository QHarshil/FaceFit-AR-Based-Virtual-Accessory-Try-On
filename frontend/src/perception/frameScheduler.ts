// Backpressure between the camera and the landmark worker: one frame in
// flight, at most one waiting. A newer frame replaces the waiting one, so the
// worker always gets the freshest frame and never builds a queue.

export type ReleaseReason = 'dropped' | 'stopped';

export interface FrameSchedulerOptions<T> {
  /** Hands a frame to the worker. Ownership moves with it. */
  send: (frame: T) => void;
  /** Frees a frame the worker will never see. */
  release: (frame: T, reason: ReleaseReason) => void;
}

export interface FrameScheduler<T> {
  /** Takes ownership of the newest camera frame. */
  offer: (frame: T) => void;
  /** The worker finished the frame in flight. */
  complete: () => void;
  /** Releases the waiting frame and every later offer. The frame in flight stays with the worker. */
  stop: () => void;
  readonly inFlight: boolean;
  readonly pending: boolean;
}

export const createFrameScheduler = <T>({
  send,
  release,
}: FrameSchedulerOptions<T>): FrameScheduler<T> => {
  let inFlight = false;
  let pending: { frame: T } | null = null;
  let stopped = false;

  const dispatch = (frame: T) => {
    inFlight = true;
    try {
      send(frame);
    } catch (error) {
      inFlight = false;
      release(frame, 'dropped');
      throw error;
    }
  };

  return {
    offer: (frame) => {
      if (stopped) {
        release(frame, 'stopped');
        return;
      }
      if (!inFlight) {
        dispatch(frame);
        return;
      }
      if (pending) release(pending.frame, 'dropped');
      pending = { frame };
    },
    complete: () => {
      if (!inFlight) return;
      inFlight = false;
      if (stopped || !pending) return;
      const next = pending.frame;
      pending = null;
      dispatch(next);
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (pending) release(pending.frame, 'stopped');
      pending = null;
    },
    get inFlight() {
      return inFlight;
    },
    get pending() {
      return pending !== null;
    },
  };
};
