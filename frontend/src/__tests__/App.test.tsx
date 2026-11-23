import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PRODUCTS } from '../test/fixtures';

// Empty stand-ins for the legacy scripts: neither registers FaceMesh or Camera.
vi.mock('@mediapipe/camera_utils', () => ({}));
vi.mock('@mediapipe/face_mesh', () => ({}));
vi.mock('../services/apiClient', () => ({
  getProducts: vi.fn().mockResolvedValue(PRODUCTS),
  getProductById: vi.fn(),
}));
vi.mock('../utils/telemetry', () => ({ sendTelemetry: vi.fn().mockResolvedValue(true) }));

const { default: App } = await import('../App');

describe('App', () => {
  it('shows the catalogue when the MediaPipe globals are missing', async () => {
    render(<App />);

    expect(await screen.findByText('Aviator Glasses')).toBeInTheDocument();
  });
});
