import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTS } from '../../test/fixtures';
import Home from '../Home';

const getProducts = vi.hoisted(() => vi.fn());

vi.mock('../../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/apiClient')>()),
  getProducts,
}));
vi.mock('../../telemetry/client', () => ({ sendTelemetry: vi.fn().mockReturnValue(true) }));

const renderHome = () =>
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/try-on/:id" element={<p>try-on page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('Home', () => {
  beforeEach(() => {
    getProducts.mockReset();
  });

  it('lists the catalogue once it loads', async () => {
    getProducts.mockResolvedValue(PRODUCTS);
    renderHome();

    expect(await screen.findByText('Aviator Glasses')).toBeInTheDocument();
    expect(screen.getByText('Round Glasses')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open Try-On' })).toHaveLength(2);
  });

  it('disables the hero actions while the catalogue loads', () => {
    getProducts.mockReturnValue(new Promise(() => {}));
    renderHome();

    expect(screen.getByRole('button', { name: 'Launch Try-On' })).toBeDisabled();
    expect(screen.queryByText('Aviator Glasses')).not.toBeInTheDocument();
  });

  it('opens the try-on page for the chosen frame', async () => {
    getProducts.mockResolvedValue(PRODUCTS);
    renderHome();

    const buttons = await screen.findAllByRole('button', { name: 'Open Try-On' });
    await userEvent.click(buttons[1] as HTMLElement);

    expect(await screen.findByText('try-on page')).toBeInTheDocument();
  });

  it('shows a retry action when the catalogue request fails', async () => {
    getProducts.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHome();

    await waitFor(() => expect(screen.getByText('Catalogue unavailable')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});
