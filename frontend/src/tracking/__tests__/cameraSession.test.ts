import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraHandle } from '../camera';
import { startCameraSession, type CameraSessionCallbacks } from '../cameraSession';

interface FakeCamera {
  attach: () => void;
  fail: (error: unknown) => void;
  live: boolean;
  track: MediaStreamTrack;
  /** The device asked for, null for any front camera. */
  deviceId: string | null;
}

const cameras: FakeCamera[] = [];

const fakeTrack = () => {
  const target = new EventTarget() as MediaStreamTrack;
  Object.defineProperty(target, 'enabled', { value: true, writable: true });
  return target;
};

// Resolves only once the test hands over a stream, like getUserMedia.
const start = (_video: HTMLVideoElement, deviceId: string | null) =>
  new Promise<CameraHandle>((resolve, reject) => {
    const camera: FakeCamera = {
      live: false,
      track: fakeTrack(),
      deviceId,
      attach: () => {
        camera.live = true;
        resolve({
          track: camera.track,
          deviceId: 'front-camera',
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

  it('stops the camera while hidden and asks for the same one when shown', async () => {
    const events = callbacks();
    const session = startCameraSession(video(), events, start);
    await flush();
    expect(latest().deviceId).toBeNull();
    latest().attach();
    await flush();

    session.pause();
    expect(liveStreams()).toBe(0);
    await flush();
    expect(cameras).toHaveLength(1);

    session.resume();
    await flush();
    expect(cameras).toHaveLength(2);
    expect(latest().deviceId).toBe('front-camera');
    latest().attach();
    await flush();
    expect(liveStreams()).toBe(1);
    expect(events.onReady).toHaveBeenCalledTimes(2);

    // The new track is watched; the released one is not.
    (cameras[0] as FakeCamera).track.dispatchEvent(new Event('ended'));
    expect(events.onEnded).not.toHaveBeenCalled();
    latest().track.dispatchEvent(new Event('ended'));
    expect(events.onEnded).toHaveBeenCalledTimes(1);
    session.stop();
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['OverconstrainedError', 'missing'],
  ])('reports a camera that fails on resume with %s as %s', async (name, failure) => {
    const events = callbacks();
    const session = startCameraSession(video(), events, start);
    await flush();
    latest().attach();
    await flush();
    session.pause();
    session.resume();
    await flush();
    latest().fail(new DOMException('x', name));
    await flush();
    expect(events.onFailed).toHaveBeenCalledWith(failure);
    session.stop();
  });

  it('releases a stream that arrives after the page was hidden again', async () => {
    const events = callbacks();
    const session = startCameraSession(video(), events, start);
    await flush();
    latest().attach();
    await flush();
    session.pause();
    session.resume();
    await flush();
    session.pause();
    latest().attach();
    await flush();
    expect(liveStreams()).toBe(0);
    expect(events.onReady).toHaveBeenCalledTimes(1);

    session.resume();
    await flush();
    latest().attach();
    await flush();
    expect(liveStreams()).toBe(1);
    session.stop();
    expect(liveStreams()).toBe(0);
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
