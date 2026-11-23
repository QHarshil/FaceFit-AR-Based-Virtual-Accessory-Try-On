import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTS } from '../../test/fixtures';
import type { Landmark } from '../../types';

const getProductById = vi.hoisted(() => vi.fn());
const camera = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  results: undefined as ((results: { multiFaceLandmarks: Landmark[][] }) => void) | undefined,
}));

vi.mock('../../services/apiClient', () => ({ getProductById }));
vi.mock('../../utils/telemetry', () => ({ sendTelemetry: vi.fn().mockResolvedValue(true) }));

vi.mock('../../tracking/mediapipeGlobals', () => ({
  Camera: class {
    start = camera.start;
    stop = camera.stop;
  },
  FaceMesh: class {
    setOptions() {}
    onResults(listener: typeof camera.results) {
      camera.results = listener;
    }
    send() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
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

const FACE: Landmark[] = Array.from({ length: 468 }, (_, i) => ({
  x: 0.4 + (i % 7) * 0.02,
  y: 0.4 + (i % 5) * 0.02,
  z: 0,
}));

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
    camera.start.mockReset().mockResolvedValue(undefined);
    camera.stop.mockReset().mockResolvedValue(undefined);
    camera.results = undefined;
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

    act(() => camera.results?.({ multiFaceLandmarks: [FACE] }));
    expect(await screen.findByText('Tracking active.')).toBeInTheDocument();

    act(() => camera.results?.({ multiFaceLandmarks: [] }));
    expect(await screen.findByText('Align your face with the camera.')).toBeInTheDocument();
  });

  it('shows a camera error with a way back when access is denied', async () => {
    getProductById.mockResolvedValue(PRODUCTS[0]);
    camera.start.mockRejectedValue(new Error('Permission denied'));
    renderTryOn();

    expect(
      await screen.findByText('Unable to start the camera. Please allow access and refresh the page.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back to catalogue' }));
    expect(await screen.findByText('catalogue page')).toBeInTheDocument();
  });

  it('shows a not-found state when the product request fails', async () => {
    getProductById.mockRejectedValue(new Error('Product not found'));
    renderTryOn();

    expect(await screen.findByText('Product not found. Please choose another frame.')).toBeInTheDocument();
    expect(camera.start).not.toHaveBeenCalled();
  });

  it('stops the camera on unmount', async () => {
    getProductById.mockResolvedValue(PRODUCTS[0]);
    const { unmount } = renderTryOn();
    await screen.findByText('Align your face with the camera.');

    unmount();

    expect(camera.stop).toHaveBeenCalled();
  });
});
