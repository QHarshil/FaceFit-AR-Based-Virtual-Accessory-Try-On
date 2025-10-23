import { sendTelemetry, __TESTING__ } from '../telemetry';

describe('sendTelemetry', () => {
  const originalNavigator = global.navigator;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalNavigator) {
      global.navigator = originalNavigator;
    } else {
      delete global.navigator;
    }
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
    jest.clearAllMocks();
  });

  it('uses navigator.sendBeacon when available', async () => {
    const sendBeacon = jest.fn().mockReturnValue(true);
    global.navigator = { sendBeacon };
    global.fetch = jest.fn();

    const result = await sendTelemetry('catalogue_loaded', { count: 4 });

    expect(sendBeacon).toHaveBeenCalledWith(
      __TESTING__.TELEMETRY_ENDPOINT,
      expect.any(Blob)
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('falls back to fetch when sendBeacon is unavailable', async () => {
    global.navigator = {};
    const jsonResponse = Promise.resolve({ ok: true });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => jsonResponse,
    });

    const result = await sendTelemetry('tracking_state_changed', { faceDetected: true });

    expect(global.fetch).toHaveBeenCalledWith(__TESTING__.TELEMETRY_ENDPOINT, expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }));
    expect(result).toBe(true);
  });

  it('resolves false when event type is missing', async () => {
    global.navigator = {};
    global.fetch = jest.fn();

    const result = await sendTelemetry('');

    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
