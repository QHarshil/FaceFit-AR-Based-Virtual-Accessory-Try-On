import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deferred } from '../../test/tryOnHarness';

const decodes = vi.hoisted(() => [] as Deferred<ImageBitmap>[]);
vi.mock('../../tracking/photo', async () => {
  const { deferred: next } = await import('../../test/tryOnHarness');
  return {
    decodePhoto: () => {
      const decode = next<ImageBitmap>();
      decodes.push(decode);
      return decode.promise;
    },
  };
});

const { default: PhotoView } = await import('../PhotoView');

const bitmap = (width: number, height: number) =>
  ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;

const canvasSize = () => {
  const canvas = screen.getByRole('img', { name: 'Your photo' }) as HTMLCanvasElement;
  return [canvas.width, canvas.height];
};

describe('PhotoView', () => {
  beforeEach(() => {
    decodes.length = 0;
    // jsdom has no 2D context.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws the photo at its decoded size and releases the decoded copy', async () => {
    render(<PhotoView photo={new Blob(['a'])} />);
    const image = bitmap(640, 800);
    await act(async () => {
      decodes[0]?.resolve(image);
      await Promise.resolve();
    });
    expect(canvasSize()).toEqual([640, 800]);
    expect(image.close).toHaveBeenCalled();
  });

  it('clears the last photo while the next decodes, and when it fails to decode', async () => {
    const view = render(<PhotoView photo={new Blob(['a'])} />);
    await act(async () => {
      decodes[0]?.resolve(bitmap(640, 800));
      await Promise.resolve();
    });
    expect(canvasSize()).toEqual([640, 800]);

    view.rerender(<PhotoView photo={new Blob(['b'])} />);
    expect(canvasSize()).toEqual([0, 0]);

    await act(async () => {
      decodes[1]?.reject(new DOMException('bad image', 'InvalidStateError'));
      await Promise.resolve();
    });
    expect(canvasSize()).toEqual([0, 0]);
  });
});
