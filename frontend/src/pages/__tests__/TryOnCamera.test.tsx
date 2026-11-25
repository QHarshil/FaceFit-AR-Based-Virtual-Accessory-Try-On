// The try-on page with the real camera session and a fake getUserMedia: what
// happens to the camera tracks on errors, a hidden tab and a product change.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTS } from '../../test/fixtures';
import type { Product } from '../../types';
import { STATUS_VIEWS } from '../../tryon/status';

const getProductById = vi.hoisted(() => vi.fn());

vi.mock('../../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/apiClient')>()),
  getProductById,
}));
vi.mock('../../telemetry/client', () => ({ sendTelemetry: vi.fn().mockReturnValue(true) }));
// No worker in jsdom; the camera is what is under test.
vi.mock('../../tracking/perceptionSession', () => ({
  startPerception: () => ({ pause: vi.fn(), resume: vi.fn(), stop: vi.fn() }),
}));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
    render() {}
    dispose() {}
    forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    setMeshoptDecoder() {}
    load() {}
  },
}));

const { default: TryOn } = await import('../TryOn');

interface FakeTrack extends EventTarget {
  readyState: 'live' | 'ended';
  stop: () => void;
  getSettings: () => { deviceId: string };
}

const streams: { constraints: MediaStreamConstraints; track: FakeTrack }[] = [];

const fakeTrack = (): FakeTrack =>
  Object.assign(new EventTarget(), {
    readyState: 'live' as const,
    stop(this: FakeTrack) {
      this.readyState = 'ended';
    },
    getSettings: () => ({ deviceId: 'front-camera' }),
  });

const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
  const track = fakeTrack();
  streams.push({ constraints, track });
  return Promise.resolve({ getTracks: () => [track], getVideoTracks: () => [track] });
});

const liveTracks = () => streams.filter(({ track }) => track.readyState === 'live');
const heading = (status: keyof typeof STATUS_VIEWS) =>
  screen.findByRole('heading', { name: STATUS_VIEWS[status].title });
const setHidden = (hidden: boolean) => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const renderTryOn = () =>
  render(
    <MemoryRouter initialEntries={['/try-on/1']}>
      <Routes>
        <Route path="/" element={<p>catalogue page</p>} />
        <Route
          path="/try-on/:id"
          element={
            <>
              <TryOn />
              <Link to="/try-on/2">Next frame</Link>
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

describe('TryOn camera tracks', () => {
  beforeEach(() => {
    streams.length = 0;
    getUserMedia.mockClear();
    getProductById.mockImplementation((id: number) =>
      Promise.resolve(PRODUCTS.find((product) => product.id === id) as Product),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      value: Object.assign(new EventTarget(), { getUserMedia }),
      configurable: true,
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('stops the track while the tab is hidden and asks for the same camera when shown', async () => {
    renderTryOn();
    await settle();
    expect(liveTracks()).toHaveLength(1);

    setHidden(true);
    await heading('paused');
    expect(liveTracks()).toHaveLength(0);

    setHidden(false);
    await heading('modelLoading');
    expect(streams).toHaveLength(2);
    expect(streams[1]?.constraints.video).toMatchObject({ deviceId: { exact: 'front-camera' } });
    expect(liveTracks()).toHaveLength(1);
  });

  it('shows a blocked camera when it is refused on return', async () => {
    renderTryOn();
    await settle();
    setHidden(true);
    await heading('paused');

    getUserMedia.mockRejectedValueOnce(new DOMException('revoked', 'NotAllowedError'));
    setHidden(false);
    await heading('cameraDenied');
    expect(liveTracks()).toHaveLength(0);
  });

  it('shows no camera on return when the camera is gone', async () => {
    renderTryOn();
    await settle();
    setHidden(true);
    await heading('paused');

    getUserMedia.mockRejectedValueOnce(new DOMException('gone', 'OverconstrainedError'));
    setHidden(false);
    await heading('cameraMissing');
  });

  it('stops the track when the video will not play', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new DOMException('busy', 'NotReadableError'),
    );
    renderTryOn();
    await heading('cameraBusy');
    expect(streams).toHaveLength(1);
    expect(liveTracks()).toHaveLength(0);
  });

  it('stops the other tracks when the camera ends', async () => {
    renderTryOn();
    await settle();
    const [first] = streams;
    if (!first) throw new Error('no camera');
    // An unplugged camera ends its track; the session must not keep the stream.
    first.track.stop = vi.fn();
    act(() => {
      first.track.dispatchEvent(new Event('ended'));
    });
    await heading('cameraEnded');
    expect(first.track.stop).toHaveBeenCalled();
  });

  it('stops the track when the product changes mid-session', async () => {
    renderTryOn();
    await settle();
    expect(liveTracks()).toHaveLength(1);
    const [first] = streams;

    await userEvent.click(screen.getByRole('link', { name: 'Next frame' }));
    await settle();
    expect(first?.track.readyState).toBe('ended');
    expect(streams).toHaveLength(2);
    expect(liveTracks()).toHaveLength(1);
  });
});
