import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerceptionError } from '../errors';
import { startFrameSource, type CapturedFrame } from '../frameSource';

type Callback = (now: number, metadata: Partial<VideoFrameCallbackMetadata>) => void;

const fakeVideo = () => {
  const callbacks = new Map<number, Callback>();
  let nextHandle = 1;
  const video = {
    requestVideoFrameCallback: vi.fn((callback: Callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    }),
    cancelVideoFrameCallback: vi.fn((handle: number) => callbacks.delete(handle)),
  };
  // Presents one camera frame: runs the callbacks registered so far, once.
  const present = (now: number, metadata: Partial<VideoFrameCallbackMetadata> = {}) => {
    const due = [...callbacks.entries()];
    callbacks.clear();
    due.forEach(([, callback]) => callback(now, metadata));
  };
  return { video: video as unknown as HTMLVideoElement, present, callbacks };
};

class FakeVideoFrame {
  static fail = false;
  constructor(
    readonly source: unknown,
    readonly init: VideoFrameInit,
  ) {
    if (FakeVideoFrame.fail) throw new DOMException('no frame', 'InvalidStateError');
  }
  close() {}
}

describe('frame source', () => {
  beforeEach(() => {
    FakeVideoFrame.fail = false;
    vi.stubGlobal('VideoFrame', FakeVideoFrame);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captures one VideoFrame per presented camera frame with increasing ids', () => {
    const { video, present } = fakeVideo();
    const frames: CapturedFrame[] = [];
    startFrameSource(video, { onFrame: (f) => frames.push(f), onError: vi.fn() });

    present(100, { captureTime: 90.25 });
    present(133, {});

    expect(frames.map((f) => f.frameId)).toEqual([0, 1]);
    expect(frames.map((f) => f.timestampMs)).toEqual([90.25, 133]);
    expect((frames[0]?.frame as unknown as FakeVideoFrame).init).toEqual({ timestamp: 90250 });
    expect((frames[0]?.frame as unknown as FakeVideoFrame).source).toBe(video);
  });

  it('stops requesting frames after stop', () => {
    const { video, present, callbacks } = fakeVideo();
    const onFrame = vi.fn();
    const stop = startFrameSource(video, { onFrame, onError: vi.fn() });
    present(1);

    stop();
    present(2);

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(0);
  });

  it('reports a capture failure once and stops', () => {
    const { video, present, callbacks } = fakeVideo();
    const onError = vi.fn();
    startFrameSource(video, { onFrame: vi.fn(), onError });
    FakeVideoFrame.fail = true;

    present(1);
    present(2);

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as PerceptionError).code).toBe('unsupported');
    expect(callbacks.size).toBe(0);
  });

  it('throws unsupported without requestVideoFrameCallback', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'requestVideoFrameCallback', { value: undefined });
    expect(() => startFrameSource(video, { onFrame: vi.fn(), onError: vi.fn() })).toThrow(
      PerceptionError,
    );
  });
});
