import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTS } from '../../test/fixtures';
import { LANDMARK_COUNT, type LandmarkFrame } from '../../perception/types';
import type { FaceTrackingCallbacks } from '../../tracking/faceTracking';

const getProductById = vi.hoisted(() => vi.fn());
const tracking = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  callbacks: undefined as FaceTrackingCallbacks | undefined,
}));

vi.mock('../../services/apiClient', () => ({ getProductById }));
vi.mock('../../utils/telemetry', () => ({ sendTelemetry: vi.fn().mockResolvedValue(true) }));

// StrictMode starts tracking twice; the callbacks of the last start are live.
vi.mock('../../tracking/faceTracking', () => ({
  startFaceTracking: (_video: HTMLVideoElement, callbacks: FaceTrackingCallbacks) => {
    tracking.callbacks = callbacks;
    return { started: tracking.start() as Promise<void>, stop: tracking.stop };
  },
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    domElement = document.createElement('canvas');
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
    load() {}
  },
}));

const { default: TryOn } = await import('../TryOn');

const FACE: LandmarkFrame = {
  timestampMs: 0,
  width: 1280,
  height: 720,
  landmarks: new Float32Array(LANDMARK_COUNT * 3).map((_, i) => 0.4 + (i % 7) * 0.02),
  faceCount: 1,
};

const NO_FACE: LandmarkFrame = { ...FACE, landmarks: new Float32Array(0), faceCount: 0 };

const renderTryOn = () =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={['/try-on/1']}>
        <Routes>
          <Route path="/" element={<p>catalogue page</p>} />
          <Route path="/try-on/:id" element={<TryOn />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );

describe('TryOn', () => {
  beforeEach(() => {
    getProductById.mockReset();
    tracking.start.mockReset().mockResolvedValue(undefined);
    tracking.stop.mockReset();
    tracking.callbacks = undefined;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows the product while the camera starts', async () => {
    getProductById.mockResolvedValue(PRODUCTS[0]);
    renderTryOn();

    expect(await screen.findByText('Aviator Glasses')).toBeInTheDocument();
    expect(await screen.findByText('Align your face with the camera.')).toBeInTheDocument();
  });

  it('reports tracking once a face is found and asks for alignment when it is lost', async () => {
    getProductById.mockResolvedValue(PRODUCTS[0]);
    renderTryOn();
    await screen.findByText('Align your face with the camera.');

    act(() => tracking.callbacks?.onLandmarks(FACE));
    expect(await screen.findByText('Tracking active.')).toBeInTheDocument();

    act(() => tracking.callbacks?.onLandmarks(NO_FACE));
    expect(await screen.findByText('Align your face with the camera.')).toBeInTheDocument();
  });

  it('shows a camera error with a way back when access is denied', async () => {
    getProductById.mockResolvedValue(PRODUCTS[0]);
    tracking.start.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    renderTryOn();

    expect(
      await screen.findByText(
        'Unable to start the camera. Please allow access and refresh the page.',
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back to catalogue' }));
    expect(await screen.findByText('catalogue page')).toBeInTheDocument();
  });

  it('shows a not-found state when the product request fails', async () => {
    getProductById.mockRejectedValue(new Error('Product not found'));
    renderTryOn();

    expect(
      await screen.findByText('Product not found. Please choose another frame.'),
    ).toBeInTheDocument();
    expect(tracking.start).not.toHaveBeenCalled();
  });

  it('stops the camera on unmount', async () => {
    getProductById.mockResolvedValue(PRODUCTS[0]);
    const { unmount } = renderTryOn();
    await screen.findByText('Align your face with the camera.');

    unmount();

    expect(tracking.stop).toHaveBeenCalled();
  });
});
