import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PRODUCT } from '../../test/tryOnHarness';
import { useTryOn } from '../useTryOn';

vi.mock('../../telemetry/client', () => ({ sendTelemetry: vi.fn() }));

describe('useTryOn', () => {
  it('drops the chosen photo when the view unmounts', async () => {
    const { result, unmount } = renderHook(
      () =>
        useTryOn(
          PRODUCT.id,
          { current: null },
          {
            getProduct: () => Promise.resolve(PRODUCT),
            detectPhoto: () => new Promise(() => {}),
          },
        ),
      { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> },
    );
    await act(() => Promise.resolve());
    act(() => {
      result.current.actor.send({ type: 'USE_PHOTO' });
      result.current.actor.send({ type: 'PHOTO_SELECTED', photo: new Blob(['jpeg']) });
    });
    expect(result.current.photo).not.toBeNull();
    const { actor } = result.current;

    unmount();
    expect(actor.getSnapshot().context.photo).toBeNull();
  });
});
