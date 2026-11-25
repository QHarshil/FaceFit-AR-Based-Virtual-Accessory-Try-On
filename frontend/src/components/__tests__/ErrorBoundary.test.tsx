import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '../ErrorBoundary';

const crash = { on: true };

function Fragile() {
  if (crash.on) throw new Error('render failed');
  return <p>surface content</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    crash.on = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows the fallback, reports the error and recovers on reset', async () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary
        surface="Test surface"
        onError={onError}
        fallback={(reset) => (
          <button type="button" onClick={reset}>
            Try again
          </button>
        )}
      >
        <Fragile />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'render failed' }));
    expect(screen.queryByText('surface content')).toBeNull();

    crash.on = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('surface content')).toBeInTheDocument();
  });

  it('names the surface in the console', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary surface="Overlay" fallback={() => null}>
        <Fragile />
      </ErrorBoundary>,
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Overlay failed',
      expect.any(Error),
      expect.anything(),
    );
  });
});
