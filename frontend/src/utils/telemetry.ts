const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5055';
const TELEMETRY_ENDPOINT = `${API_URL}/api/telemetry`;

export type TelemetryPayload = Record<string, unknown>;

const buildPayload = (eventType: string, payload: TelemetryPayload) => ({
  eventType,
  payload,
  timestamp: new Date().toISOString(),
});

export const sendTelemetry = (
  eventType: string,
  payload: TelemetryPayload = {},
): Promise<boolean> => {
  if (!eventType) {
    return Promise.resolve(false);
  }

  const body = JSON.stringify(buildPayload(eventType, payload));

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' });
    const delivered = navigator.sendBeacon(TELEMETRY_ENDPOINT, blob);
    if (delivered) {
      return Promise.resolve(true);
    }
  }

  return fetch(TELEMETRY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).then(
    () => true,
    () => false,
  );
};

export const __TESTING__ = {
  TELEMETRY_ENDPOINT,
  buildPayload,
};
