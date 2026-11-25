import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PRODUCTS } from '../test/fixtures';

vi.mock('../services/apiClient', () => ({
  getProducts: vi.fn().mockResolvedValue(PRODUCTS),
  getProductById: vi.fn(),
}));
vi.mock('../telemetry/client', () => ({ sendTelemetry: vi.fn().mockReturnValue(true) }));

const { default: App } = await import('../App');

describe('App', () => {
  it('shows the catalogue when the MediaPipe globals are missing', async () => {
    render(<App />);

    expect(await screen.findByText('Aviator Glasses')).toBeInTheDocument();
  });

  it('shows a not-found page with a way back for an unknown route', async () => {
    window.history.pushState({}, '', '/no-such-page');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to catalogue' })).toHaveAttribute('href', '/');
    window.history.pushState({}, '', '/');
  });
});
