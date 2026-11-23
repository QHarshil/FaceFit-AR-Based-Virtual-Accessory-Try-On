import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeCamera {
  attachStream: () => void;
  streamLive: boolean;
  startCalls: number;
}

const cameras: FakeCamera[] = [];
const faceMeshes: { close: ReturnType<typeof vi.fn> }[] = [];

// Mirrors camera_utils: stop() only stops a stream that start() already attached.
vi.mock('../mediapipeGlobals', () => {
  const Camera = class {
    private readonly entry: FakeCamera = {
      attachStream: () => {},
      streamLive: false,
      startCalls: 0,
    };
    private attached = false;
    constructor() {
      cameras.push(this.entry);
    }
    start() {
      this.entry.startCalls += 1;
      return new Promise<void>((resolve) => {
        this.entry.attachStream = () => {
          this.attached = true;
          this.entry.streamLive = true;
          resolve();
        };
      });
    }
    stop() {
      if (this.attached) {
        this.entry.streamLive = false;
        this.attached = false;
      }
      return Promise.resolve();
    }
  };
  const FaceMesh = class {
    constructor() {
      faceMeshes.push(this);
    }
    close = vi.fn().mockResolvedValue(undefined);
    setOptions() {}
    onResults() {}
    send() {
      return Promise.resolve();
    }
  };
  return { getMediapipe: () => ({ Camera, FaceMesh }) };
});

const { startFaceTracking } = await import('../faceTracking');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const liveStreams = () => cameras.filter((camera) => camera.streamLive).length;

describe('startFaceTracking', () => {
  beforeEach(() => {
    cameras.length = 0;
    faceMeshes.length = 0;
  });

  it('never starts the camera when stop arrives first', async () => {
    const tracking = startFaceTracking(document.createElement('video'), () => {});
    tracking.stop();
    await tracking.started;

    expect(cameras[0]?.startCalls).toBe(0);
    expect(liveStreams()).toBe(0);
  });

  it('stops the stream that arrives after stop', async () => {
    const tracking = startFaceTracking(document.createElement('video'), () => {});
    await flush();
    expect(cameras[0]?.startCalls).toBe(1);

    tracking.stop();
    cameras[0]?.attachStream();
    await tracking.started;

    expect(liveStreams()).toBe(0);
  });

  it('leaves exactly one live stream after a StrictMode double setup', async () => {
    const video = document.createElement('video');
    const first = startFaceTracking(video, () => {});
    first.stop();
    const second = startFaceTracking(video, () => {});
    await flush();
    cameras[1]?.attachStream();
    await second.started;

    expect(liveStreams()).toBe(1);
    expect(cameras[0]?.startCalls).toBe(0);

    second.stop();
    expect(liveStreams()).toBe(0);
    expect(faceMeshes.map((mesh) => mesh.close.mock.calls.length)).toEqual([1, 1]);
  });

  it('holds the next camera until the previous stream has attached', async () => {
    const video = document.createElement('video');
    const first = startFaceTracking(video, () => {});
    await flush();
    expect(cameras[0]?.startCalls).toBe(1);

    first.stop();
    const second = startFaceTracking(video, () => {});
    await flush();
    expect(cameras[1]?.startCalls).toBe(0);

    cameras[0]?.attachStream();
    await first.started;
    await flush();
    expect(cameras[1]?.startCalls).toBe(1);
    expect(cameras[0]?.streamLive).toBe(false);

    cameras[1]?.attachStream();
    await second.started;
    expect(liveStreams()).toBe(1);
  });
});
