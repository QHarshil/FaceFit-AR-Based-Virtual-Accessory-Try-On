import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraHandle } from '../camera';
import { startCameraSession, type CameraSessionCallbacks } from '../cameraSession';

interface FakeCamera {
  attach: () => void;
  fail: (error: unknown) => void;
  live: boolean;
  track: MediaStreamTrack;
}

const cameras: FakeCamera[] = [];

const fakeTrack = () => {
  const target = new EventTarget() as MediaStreamTrack;
  Object.defineProperty(target, 'enabled', { value: true, writable: true });
  return target;
};

// Resolves only once the test hands over a stream, like getUserMedia.
const start = () =>
  new Promise<CameraHandle>((resolve, reject) => {
    const camera: FakeCamera = {
      live: false,
      track: fakeTrack(),
      attach: () => {
        camera.live = true;
        resolve({
          track: camera.track,
          release: () => {
            camera.live = false;
          },
        });
      },
      fail: reject,
    };
    cameras.push(camera);
  });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const liveStreams = () => cameras.filter((camera) => camera.live).length;
const callbacks = (): CameraSessionCallbacks => ({
  onReady: vi.fn(),
  onFailed: vi.fn(),
  onEnded: vi.fn(),
});
const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();
const video = () => {
  const element = document.createElement('video');
  element.play = play;
  element.pause = pause;
  return element;
};
const latest = () => {
  const camera = cameras[cameras.length - 1];
  if (!camera) throw new Error('no camera requested');
  return camera;
};

describe('startCameraSession', () => {
  beforeEach(async () => {
    cameras.length = 0;
    // Let the previous test's session chain settle.
    await flush();
  });

  it('reports ready once the stream attaches', async () => {
    const events = callbacks();
    startCameraSession(video(), events, start);
    await flush();
    expect(events.onReady).not.toHaveBeenCalled();
    latest().attach();
    await flush();
    expect(events.onReady).toHaveBeenCalledTimes(1);
  });

  it('never starts the camera when stop arrives first', async () => {
    startCameraSession(video(), callbacks(), start).stop();
    await flush();
    expect(cameras).toHaveLength(0);
  });

  it('releases a stream that arrives after stop', async () => {
    const events = callbacks();
    const session = startCameraSession(video(), events, start);
    await flush();
    session.stop();
    latest().attach();
    await flush();
    expect(liveStreams()).toBe(0);
    expect(events.onReady).not.toHaveBeenCalled();
  });

  it('leaves exactly one live stream after a StrictMode double start', async () => {
    const element = video();
    startCameraSession(element, callbacks(), start).stop();
    startCameraSession(element, callbacks(), start);
    await flush();
    cameras.forEach((camera) => {
      camera.attach();
    });
    await flush();
    expect(liveStreams()).toBe(1);
  });

  it('holds the next camera until the previous one has settled', async () => {
    const element = video();
    const first = startCameraSession(element, callbacks(), start);
    await flush();
    first.stop();
    const second = startCameraSession(element, callbacks(), start);
    await flush();
    expect(cameras).toHaveLength(1);
    latest().attach();
    await flush();
    expect(cameras).toHaveLength(2);
    // Settles the chain for the next test.
    latest().attach();
    second.stop();
    await flush();
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'missing'],
    ['NotReadableError', 'busy'],
    ['NotSupportedError', 'unsupported'],
    ['TypeError', 'unknown'],
  ])('classifies %s as %s', async (name, failure) => {
    const events = callbacks();
    startCameraSession(video(), events, start);
    await flush();
    latest().fail(new DOMException('x', name));
    await flush();
    expect(events.onFailed).toHaveBeenCalledWith(failure);
  });

  it('disables the track and pauses the video while hidden, and restores both', async () => {
    const element = video();
    const session = startCameraSession(element, callbacks(), start);
    await flush();
    latest().attach();
    await flush();

    session.pause();
    expect(latest().track.enabled).toBe(false);
    expect(pause).toHaveBeenCalled();

    session.resume();
    expect(latest().track.enabled).toBe(true);
    expect(play).toHaveBeenCalled();
  });

  it('reports an ended track while running, and not after stop', async () => {
    const events = callbacks();
    const session = startCameraSession(video(), events, start);
    await flush();
    latest().attach();
    await flush();

    latest().track.dispatchEvent(new Event('ended'));
    expect(events.onEnded).toHaveBeenCalledTimes(1);

    session.stop();
    latest().track.dispatchEvent(new Event('ended'));
    expect(events.onEnded).toHaveBeenCalledTimes(1);
    expect(liveStreams()).toBe(0);
  });
});
