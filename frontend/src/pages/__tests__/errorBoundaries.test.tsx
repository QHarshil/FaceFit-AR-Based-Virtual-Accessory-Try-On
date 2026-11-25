// Each surface has its own error boundary: a crash in one leaves the others
// working and offers a way back.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTS } from '../../test/fixtures';
import type { Product } from '../../types';
import { STATUS_VIEWS } from '../../tryon/status';

const crash = vi.hoisted(() => ({ overlay: false, status: false }));
const getProductById = vi.hoisted(() => vi.fn());
const getProducts = vi.hoisted(() => vi.fn());
const sendTelemetry = vi.hoisted(() => vi.fn());

vi.mock('../../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/apiClient')>()),
  getProductById,
  getProducts,
}));
vi.mock('../../telemetry/client', () => ({ sendTelemetry }));
vi.mock('../../tracking/cameraSession', () => ({
  startCameraSession: () => ({ pause: vi.fn(), resume: vi.fn(), stop: vi.fn() }),
}));
vi.mock('../../tracking/perceptionSession', () => ({
  startPerception: () => ({ pause: vi.fn(), resume: vi.fn(), stop: vi.fn() }),
}));
vi.mock('../../components/ARTryOn', () => ({
  default: function ARTryOn() {
    if (crash.overlay) throw new Error('overlay render failed');
    return <div data-testid="overlay" />;
  },
}));
vi.mock('../../components/StatusPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/StatusPanel')>();
  return {
    default: function StatusPanel(props: Parameters<typeof actual.default>[0]) {
      if (crash.status) throw new Error('status render failed');
      return actual.default(props);
    },
  };
});

const { default: TryOn } = await import('../TryOn');
const { default: Home } = await import('../Home');

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/try-on/:id" element={<TryOn />} />
      </Routes>
    </MemoryRouter>,
  );

describe('error boundaries', () => {
  beforeEach(() => {
    crash.overlay = false;
    crash.status = false;
    getProductById.mockReset().mockResolvedValue(PRODUCTS[0]);
    getProducts.mockReset().mockResolvedValue(PRODUCTS);
    sendTelemetry.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('keeps the try-on running when the overlay crashes and offers a retry', async () => {
    crash.overlay = true;
    renderAt('/try-on/1');

    expect(
      await screen.findByRole('heading', { name: STATUS_VIEWS.glassesFailed.title }),
    ).toBeInTheDocument();
    expect(sendTelemetry).toHaveBeenCalledWith({
      eventType: 'render_error',
      payload: { productId: 1, errorCode: 'render_crash' },
    });

    crash.overlay = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('overlay')).toBeInTheDocument();
  });

  it('replaces a crashed try-on view with a way to retry or leave', async () => {
    crash.status = true;
    renderAt('/try-on/1');

    expect(
      await screen.findByRole('heading', { name: 'The try-on stopped working' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to catalogue' })).toHaveAttribute('href', '/');

    crash.status = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: STATUS_VIEWS.cameraRequesting.title }),
    ).toBeInTheDocument();
  });

  it('contains a catalogue crash to the product grid', async () => {
    const broken = {
      ...PRODUCTS[0],
      get name(): string {
        throw new Error('card render failed');
      },
    } as Product;
    getProducts.mockResolvedValue([broken]);
    renderAt('/');

    expect(await screen.findByText('The catalogue could not be shown')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'FaceFit AR' })).toBeInTheDocument();
  });
});
