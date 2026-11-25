// Captures camera frames at camera rate. requestVideoFrameCallback fires once
// per new video frame, so no frame is captured twice and none waits for the
// next animation frame.
import { probe } from '../utils/probe';
import { PerceptionError } from './errors';

export interface CapturedFrame {
  frameId: number;
  frame: VideoFrame;
  /** Capture time when the browser reports it, else the callback time. */
  timestampMs: number;
  /** `performance.now()` when the frame callback ran. */
  capturedAt: number;
}

export interface FrameSourceCallbacks {
  onFrame: (captured: CapturedFrame) => void;
  onError: (error: PerceptionError) => void;
}

export const frameCaptureSupported = (video: HTMLVideoElement): boolean =>
  typeof video.requestVideoFrameCallback === 'function' && typeof VideoFrame === 'function';

/** Returns a function that stops capture. */
export const startFrameSource = (
  video: HTMLVideoElement,
  { onFrame, onError }: FrameSourceCallbacks,
): (() => void) => {
  if (!frameCaptureSupported(video)) {
    throw new PerceptionError('unsupported', 'requestVideoFrameCallback or VideoFrame is missing');
  }
  let active = true;
  let nextFrameId = 0;
  let handle = 0;

  const stop = () => {
    if (!active) return;
    active = false;
    video.cancelVideoFrameCallback(handle);
  };

  const onVideoFrame: VideoFrameRequestCallback = (now, metadata) => {
    if (!active) return;
    handle = video.requestVideoFrameCallback(onVideoFrame);
    const capturedAt = performance.now();
    const timestampMs = metadata.captureTime ?? now;
    let frame: VideoFrame;
    try {
      frame = new VideoFrame(video, { timestamp: Math.round(timestampMs * 1000) });
    } catch (error) {
      stop();
      onError(new PerceptionError('unsupported', `Cannot capture a video frame: ${String(error)}`));
      return;
    }
    const frameId = nextFrameId;
    nextFrameId += 1;
    onFrame({ frameId, frame, timestampMs, capturedAt });
    // mediaTime lets the harness find which clip frame this was.
    probe({
      stage: 'capture',
      frameId,
      timestampMs,
      mediaTime: metadata.mediaTime,
      start: capturedAt,
      end: performance.now(),
    });
  };

  handle = video.requestVideoFrameCallback(onVideoFrame);
  return stop;
};
