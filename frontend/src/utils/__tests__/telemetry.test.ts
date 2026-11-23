import { afterEach, describe, expect, it, vi } from 'vitest';
import { __TESTING__, sendTelemetry } from '../telemetry';

describe('sendTelemetry', () => {
  afterEach(() => {
    Reflect.deleteProperty(window.navigator, 'sendBeacon');
    vi.unstubAllGlobals();
  });

  it('uses navigator.sendBeacon when available', async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    // jsdom's navigator is not assignable; define the method on it instead.
    Object.defineProperty(window.navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const delivered = await sendTelemetry('catalogue_loaded', { count: 4 });

    expect(sendBeacon).toHaveBeenCalledWith(__TESTING__.TELEMETRY_ENDPOINT, expect.any(Blob));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(delivered).toBe(true);
  });

  it('falls back to fetch when sendBeacon is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const delivered = await sendTelemetry('tracking_state_changed', { faceDetected: true });

    expect(fetchMock).toHaveBeenCalledWith(
      __TESTING__.TELEMETRY_ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }),
    );
    expect(delivered).toBe(true);
  });

  it('resolves false when event type is missing', async () => {
    vi.stubGlobal('navigator', {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const delivered = await sendTelemetry('');

    expect(delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
