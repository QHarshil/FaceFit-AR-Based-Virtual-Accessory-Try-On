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

// Where an off-origin request issued inside the worker ended up: refused by
// the worker's same-origin guard and reported, recorded as a request (which
// fails a measured run), or neither. `blocked` holds the URLs the guard
// reported, origin and path only.
export const guardOutcome = (url, { blocked, requests }) => {
  if (blocked.includes(url)) return 'blocked';
  if (requests.includes(url)) return 'detected';
  return 'missed';
};

// The model is fetched inside the worker. Seeing it proves the capture covers
// worker traffic, so an empty off-device list is not a blind spot.
export const sawWorkerFetch = (urls) => urls.some((url) => url.endsWith('/face_landmarker.task'));

/**
 * Waits until a local server answers on `port` at any of the addresses
 * `localhost` can mean. Node's fetch tries one, and a server that listens on
 * ::1 only (vite preview on some Linux images) refuses the other.
 */
export const waitForLocalServer = async (port, { path = '/', attempts = 200, delayMs = 200 } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      try {
        if ((await fetch(`http://${host}:${port}${path}`)).ok) return true;
      } catch {
        // not listening on this address
      }
    }
    await new Promise((done) => setTimeout(done, delayMs));
  }
  return false;
};
