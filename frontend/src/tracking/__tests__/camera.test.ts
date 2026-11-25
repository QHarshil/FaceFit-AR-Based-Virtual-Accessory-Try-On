import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCamera } from '../camera';

const fakeStream = (deviceId = 'front-camera') => {
  const stop = vi.fn<() => void>();
  const track = {
    stop,
    getSettings: () => ({ deviceId }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track, stop };
};

const withCamera = (stream: MediaStream) => {
  const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(() =>
    Promise.resolve(stream),
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  return getUserMedia;
};

const videoThat = (play: () => Promise<void>) => {
  const video = document.createElement('video');
  video.play = play;
  return video;
};

describe('startCamera', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('plays the front camera and reports the device that answered', async () => {
    const { stream, track, stop } = fakeStream();
    const getUserMedia = withCamera(stream);
    const video = videoThat(() => Promise.resolve());

    const handle = await startCamera(video);

    expect(getUserMedia.mock.calls[0]?.[0].video).toMatchObject({ facingMode: 'user' });
    expect(video.srcObject).toBe(stream);
    expect(handle.track).toBe(track);
    expect(handle.deviceId).toBe('front-camera');

    handle.release();
    expect(stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
  });

  it('asks for one camera by id when given one', async () => {
    const getUserMedia = withCamera(fakeStream().stream);
    await startCamera(
      videoThat(() => Promise.resolve()),
      'front-camera',
    );
    expect(getUserMedia.mock.calls[0]?.[0].video).toMatchObject({
      deviceId: { exact: 'front-camera' },
    });
  });

  it('stops the tracks when the video refuses to play', async () => {
    const { stream, stop } = fakeStream();
    withCamera(stream);
    const video = videoThat(() => Promise.reject(new DOMException('no', 'NotAllowedError')));

    await expect(startCamera(video)).rejects.toThrow('no');
    expect(stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
  });
});
