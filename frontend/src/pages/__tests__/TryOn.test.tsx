import { estimateIntrinsics, type HeadPose } from '@facefit/cv';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler, StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HORIZONTAL_FOV_DEG } from '../../geometry/headPose';
import type { LandmarkFrame } from '../../perception/types';
import { ApiError } from '../../services/apiClient';
import type { CameraSessionCallbacks } from '../../tracking/cameraSession';
import type { PerceptionCallbacks } from '../../tracking/perceptionSession';
import type { PoseStream } from '../../tracking/poseStream';
import { PRODUCTS } from '../../test/fixtures';
import type { Product } from '../../types';
import { rotationFromDegrees, syntheticLandmarkFrame } from '../../test/syntheticFace';
import { STATUS_VIEWS } from '../../tryon/status';

const getProductById = vi.hoisted(() => vi.fn());
const webgl = vi.hoisted(() => ({ available: true }));
const sessions = vi.hoisted(() => ({
  cameras: [] as {
    callbacks: CameraSessionCallbacks;
    pause: () => void;
    resume: () => void;
    stop: () => void;
  }[],
  perceptions: [] as {
    callbacks: PerceptionCallbacks;
    poseStream: PoseStream;
    pause: () => void;
    resume: () => void;
    stop: () => void;
  }[],
}));
const photos = vi.hoisted(() => ({ detect: vi.fn() }));
const models = vi.hoisted(() => ({
  loads: [] as { onLoad: (gltf: { scene: unknown }) => void; onError: (e: unknown) => void }[],
}));

vi.mock('../../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/apiClient')>()),
  getProductById,
}));
vi.mock('../../telemetry/client', () => ({ sendTelemetry: vi.fn().mockReturnValue(true) }));

vi.mock('../../tracking/cameraSession', () => ({
  startCameraSession: (_video: HTMLVideoElement, callbacks: CameraSessionCallbacks) => {
    const session = { callbacks, pause: vi.fn(), resume: vi.fn(), stop: vi.fn() };
    sessions.cameras.push(session);
    return session;
  },
}));

vi.mock('../../tracking/perceptionSession', () => ({
  startPerception: (
    _video: HTMLVideoElement,
    poseStream: PoseStream,
    callbacks: PerceptionCallbacks,
  ) => {
    const session = { callbacks, poseStream, pause: vi.fn(), resume: vi.fn(), stop: vi.fn() };
    sessions.perceptions.push(session);
    return session;
  },
}));

vi.mock('../../tracking/photo', () => ({
  detectPhotoFace: photos.detect,
  // jsdom cannot decode images.
  decodePhoto: () => Promise.reject(new Error('no decoder')),
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    constructor() {
      if (!webgl.available) throw new Error('Error creating WebGL context.');
    }
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
    load(
      _path: string,
      onLoad: (gltf: { scene: unknown }) => void,
      _progress: unknown,
      onError: (e: unknown) => void,
    ) {
      models.loads.push({ onLoad, onError });
    }
  },
}));

const { default: TryOn } = await import('../TryOn');

const PRODUCT = PRODUCTS[0] as Product;
const latest = <T,>(list: T[]): T => {
  const item = list[list.length - 1];
  if (!item) throw new Error('not started');
  return item;
};

const title = (status: keyof typeof STATUS_VIEWS) => STATUS_VIEWS[status].title;
const heading = (status: keyof typeof STATUS_VIEWS) =>
  screen.findByRole('heading', { name: title(status) });

let renders = 0;
const renderTryOn = (path = '/try-on/1') =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Profiler
          id="try-on"
          onRender={() => {
            renders += 1;
          }}
        >
          <Routes>
            <Route path="/" element={<p>catalogue page</p>} />
            <Route path="/try-on/:id" element={<TryOn />} />
          </Routes>
        </Profiler>
      </MemoryRouter>
    </StrictMode>,
  );

const loadModel = () => act(() => latest(models.loads).onLoad({ scene: new THREE.Group() }));

/** Product loaded, camera and model ready, glasses loaded: looking for a face. */
const startTracking = async () => {
  getProductById.mockResolvedValue(PRODUCT);
  const view = renderTryOn();
  await heading('cameraRequesting');
  act(() => latest(sessions.cameras).callbacks.onReady());
  act(() => latest(sessions.perceptions).callbacks.onReady());
  loadModel();
  await heading('searching');
  return view;
};

const faceFound = () =>
  act(() =>
    latest(sessions.perceptions).callbacks.onFaceStatus({
      faces: 1,
      tracked: true,
      lowLight: false,
    }),
  );

const intrinsics = estimateIntrinsics({
  width: 1280,
  height: 720,
  horizontalFovDeg: DEFAULT_HORIZONTAL_FOV_DEG,
})!;
const POSE: HeadPose = { rotation: rotationFromDegrees(-4, 12, 6), translationMm: [20, -10, 600] };
const faceFrame = (k: number): LandmarkFrame => ({
  ...syntheticLandmarkFrame(POSE, intrinsics),
  timestampMs: k * 33,
});

describe('TryOn', () => {
  beforeEach(() => {
    getProductById.mockReset();
    sessions.cameras.length = 0;
    sessions.perceptions.length = 0;
    models.loads.length = 0;
    webgl.available = true;
    renders = 0;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('walks from the product through the camera and model to tracking', async () => {
    getProductById.mockResolvedValue(PRODUCT);
    renderTryOn();

    await heading('cameraRequesting');
    expect(screen.getByRole('heading', { level: 1, name: PRODUCT.name })).toBeInTheDocument();
    act(() => latest(sessions.cameras).callbacks.onReady());
    await heading('modelLoading');
    act(() => latest(sessions.perceptions).callbacks.onReady());
    await heading('glassesLoading');
    loadModel();
    await heading('searching');
    faceFound();
    await heading('tracking');
    expect(screen.getByRole('status')).toHaveTextContent(STATUS_VIEWS.tracking.announcement);
  });

  it('credits the model on the try-on page', async () => {
    getProductById.mockResolvedValue(PRODUCT);
    renderTryOn();
    await heading('cameraRequesting');
    expect(screen.getByRole('link', { name: PRODUCT.attribution.title })).toHaveAttribute(
      'href',
      PRODUCT.attribution.sourceUrl,
    );
    expect(screen.getByRole('link', { name: PRODUCT.attribution.author })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
      'href',
      PRODUCT.attribution.licenseUrl,
    );
  });

  it('tells a missing product from a network failure, and retries the second', async () => {
    getProductById.mockRejectedValueOnce(new ApiError('network', 'offline'));
    renderTryOn();
    await heading('productUnavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('Check your connection');

    getProductById.mockResolvedValueOnce(PRODUCT);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: PRODUCT.name })).toBeVisible();
  });

  it('shows not found for an unknown product without a retry', async () => {
    getProductById.mockRejectedValue(new ApiError('not_found', 'Product not found', 404));
    renderTryOn();
    await heading('productNotFound');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(sessions.cameras).toHaveLength(0);
  });

  it('does not request an id that is not a product id', async () => {
    renderTryOn('/try-on/1e2');
    await heading('productNotFound');
    expect(getProductById).not.toHaveBeenCalled();
  });

  it('offers a retry and a photo when the camera is blocked', async () => {
    getProductById.mockResolvedValue(PRODUCT);
    renderTryOn();
    await heading('cameraRequesting');

    act(() => latest(sessions.cameras).callbacks.onFailed('denied'));
    await heading('cameraDenied');
    const started = sessions.cameras.length;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(sessions.cameras.length).toBeGreaterThan(started);
    await heading('cameraRequesting');

    act(() => latest(sessions.cameras).callbacks.onFailed('denied'));
    await userEvent.click(await screen.findByRole('button', { name: 'Use a photo' }));
    await heading('photoChoosing');
    expect(latest(sessions.cameras).stop).toHaveBeenCalled();
  });

  it('goes back to the catalogue', async () => {
    getProductById.mockResolvedValue(PRODUCT);
    renderTryOn();
    await heading('cameraRequesting');
    await userEvent.click(screen.getByRole('link', { name: 'Back to catalogue' }));
    expect(await screen.findByText('catalogue page')).toBeInTheDocument();
  });

  it('says rendering is off when WebGL is unavailable', async () => {
    getProductById.mockResolvedValue(PRODUCT);
    webgl.available = false;
    renderTryOn();
    await heading('webglUnavailable');
  });

  it('replaces tracking with a restoring message when the WebGL context is lost', async () => {
    const view = await startTracking();
    faceFound();
    await heading('tracking');

    const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
    act(() => {
      canvas.dispatchEvent(new Event('webglcontextlost'));
    });
    await heading('contextLost');
    expect(screen.queryByRole('heading', { name: title('tracking') })).toBeNull();

    act(() => {
      canvas.dispatchEvent(new Event('webglcontextrestored'));
    });
    await heading('tracking');
  });

  it('reloads the glasses after a failed load', async () => {
    getProductById.mockResolvedValue(PRODUCT);
    renderTryOn();
    await heading('cameraRequesting');
    act(() => latest(models.loads).onError(new Error('404')));
    await heading('glassesFailed');

    const loadsBefore = models.loads.length;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(models.loads.length).toBeGreaterThan(loadsBefore);
    loadModel();
    await heading('cameraRequesting');
  });

  it('pauses the camera and frames while the tab is hidden', async () => {
    await startTracking();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await heading('paused');
    expect(latest(sessions.cameras).pause).toHaveBeenCalled();
    expect(latest(sessions.perceptions).pause).toHaveBeenCalled();

    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // The camera was released, so the page waits for it again.
    await heading('cameraRequesting');
    expect(latest(sessions.cameras).resume).toHaveBeenCalled();
    expect(latest(sessions.perceptions).resume).toHaveBeenCalled();
    act(() => latest(sessions.cameras).callbacks.onReady());
    await heading('searching');
    hidden.mockRestore();
  });

  it('restarts a crashed worker and then asks the user', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startTracking();
    const before = sessions.perceptions.length;
    act(() => latest(sessions.perceptions).callbacks.onFailed('crashed'));
    await heading('trackingRestarting');
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(sessions.perceptions.length).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  it('tries on with a photo without sending or storing it', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    photos.detect.mockResolvedValue(faceFrame(0));
    await startTracking();
    await userEvent.click(screen.getByRole('button', { name: 'Use a photo' }));
    await heading('photoChoosing');
    expect(latest(sessions.perceptions).stop).toHaveBeenCalled();

    const photo = new File(['jpeg bytes'], 'me.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Photo of your face'), photo);
    await heading('photoShowing');
    expect(photos.detect).toHaveBeenCalledWith(photo, expect.any(AbortSignal));
    expect(screen.getByRole('img', { name: 'Your photo' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage.length + sessionStorage.length).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: 'Use the camera' }));
    await heading('cameraRequesting');
    expect(screen.queryByRole('img', { name: 'Your photo' })).toBeNull();
  });

  it('keeps a picked photo out of storage and off the network', async () => {
    const network = {
      fetch: vi.fn(),
      beacon: vi.fn(),
      xhr: vi.spyOn(XMLHttpRequest.prototype, 'open'),
      socket: vi.fn(),
    };
    vi.stubGlobal('fetch', network.fetch);
    vi.stubGlobal('WebSocket', network.socket);
    Object.defineProperty(navigator, 'sendBeacon', { value: network.beacon, configurable: true });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const openDatabase = vi.fn();
    vi.stubGlobal('indexedDB', { open: openDatabase });
    const objectUrl = vi.fn();
    // jsdom has no createObjectURL.
    Object.defineProperty(URL, 'createObjectURL', { value: objectUrl, configurable: true });
    photos.detect.mockResolvedValue(faceFrame(0));

    await startTracking();
    await userEvent.click(screen.getByRole('button', { name: 'Use a photo' }));
    await userEvent.upload(
      screen.getByLabelText('Photo of your face'),
      new File(['jpeg bytes'], 'me.jpg', { type: 'image/jpeg' }),
    );
    await heading('photoShowing');
    await userEvent.click(screen.getByRole('button', { name: 'Use the camera' }));
    await heading('cameraRequesting');

    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.beacon).not.toHaveBeenCalled();
    expect(network.xhr).not.toHaveBeenCalled();
    expect(network.socket).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(openDatabase).not.toHaveBeenCalled();
    expect(objectUrl).not.toHaveBeenCalled();

    Reflect.deleteProperty(navigator, 'sendBeacon');
    Reflect.deleteProperty(URL, 'createObjectURL');
    network.xhr.mockRestore();
    setItem.mockRestore();
    vi.unstubAllGlobals();
  });

  it('asks for another photo when none has a face', async () => {
    photos.detect.mockResolvedValue({
      timestampMs: 0,
      width: 640,
      height: 480,
      landmarks: new Float32Array(0),
      faceCount: 0,
      trackId: null,
    });
    await startTracking();
    await userEvent.click(screen.getByRole('button', { name: 'Use a photo' }));
    await userEvent.upload(
      screen.getByLabelText('Photo of your face'),
      new File(['x'], 'a.png', { type: 'image/png' }),
    );
    await heading('photoNoFace');
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeInTheDocument();
  });

  it('stops the camera and the worker on unmount', async () => {
    const view = await startTracking();
    view.unmount();
    expect(latest(sessions.cameras).stop).toHaveBeenCalled();
    expect(latest(sessions.perceptions).stop).toHaveBeenCalled();
  });
});

describe('TryOn and the pose stream', () => {
  beforeEach(() => {
    getProductById.mockReset();
    sessions.cameras.length = 0;
    sessions.perceptions.length = 0;
    models.loads.length = 0;
    webgl.available = true;
    renders = 0;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('does not re-render the page for frames that leave the status unchanged', async () => {
    await startTracking();
    const { poseStream } = latest(sessions.perceptions);
    act(() => {
      poseStream.push(faceFrame(0));
    });
    faceFound();
    await heading('tracking');

    const before = renders;
    act(() => {
      for (let k = 1; k <= 120; k += 1) poseStream.push(faceFrame(k));
    });
    expect(renders).toBe(before);
  });

  it('re-renders when the coarse pose snapshot changes', async () => {
    await startTracking();
    faceFound();
    await heading('tracking');
    const { poseStream } = latest(sessions.perceptions);

    // A face in view whose pose the gate rejects: landmarks scattered off the face model.
    const scattered = faceFrame(0);
    scattered.landmarks = scattered.landmarks.map((value, i) => value + ((i * 7919) % 13) * 0.01);
    const before = renders;
    act(() => {
      for (let k = 0; k < 20; k += 1) poseStream.push({ ...scattered, timestampMs: k * 33 });
    });
    await heading('faceTurned');
    expect(renders).toBeGreaterThan(before);
  });
});
