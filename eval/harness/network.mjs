// Classifies the requests a page made during a run. The app and the API both
// run on localhost under the harness, so any other host means data could
// leave the device.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

export const leavesDevice = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  // blob: and data: resolve in the page and never reach the network.
  if (parsed.protocol === 'blob:' || parsed.protocol === 'data:') return false;
  if (!NETWORK_PROTOCOLS.has(parsed.protocol)) return true;
  return !LOCAL_HOSTS.has(parsed.hostname);
};

export const offDeviceRequests = (urls) => [...new Set(urls.filter(leavesDevice))];

// The model is fetched inside the worker. Seeing it proves the capture covers
// worker traffic, so an empty off-device list is not a blind spot.
export const sawWorkerFetch = (urls) => urls.some((url) => url.endsWith('/face_landmarker.task'));
