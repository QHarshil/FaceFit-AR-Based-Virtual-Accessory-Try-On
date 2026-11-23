import { describe, expect, it, vi } from 'vitest';
import { sameOriginFetch } from '../sameOriginFetch';

const ORIGIN = 'http://localhost:4177';

describe('sameOriginFetch', () => {
  it('rejects the MediaPipe usage log endpoint without calling fetch', async () => {
    const nativeFetch = vi.fn(() => Promise.resolve(new Response('')));
    const guarded = sameOriginFetch(nativeFetch, ORIGIN);

    await expect(
      guarded('https://odml.pa.googleapis.com/v1/log', { method: 'POST' }),
    ).rejects.toThrow('Blocked request to https://odml.pa.googleapis.com');
    await expect(guarded(new URL('http://localhost:5055/api/telemetry'))).rejects.toThrow(
      TypeError,
    );
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('passes relative, same-origin and same-origin blob URLs through', async () => {
    const nativeFetch = vi.fn(() => Promise.resolve(new Response('')));
    const guarded = sameOriginFetch(nativeFetch, ORIGIN);

    await guarded('/mediapipe/face_landmarker.task');
    await guarded(`${ORIGIN}/assets/x.wasm`, { method: 'HEAD' });
    await guarded(new Request(`${ORIGIN}/a`));
    await guarded(`blob:${ORIGIN}/9b1f`);

    expect(nativeFetch).toHaveBeenCalledTimes(4);
    expect(nativeFetch).toHaveBeenCalledWith(`${ORIGIN}/assets/x.wasm`, { method: 'HEAD' });
  });
});
