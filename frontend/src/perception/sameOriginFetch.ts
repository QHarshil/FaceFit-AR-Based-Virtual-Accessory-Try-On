type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const urlOf = (input: RequestInfo | URL): string =>
  input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;

/**
 * Wraps `fetch` so it rejects any URL outside `origin`. MediaPipe Tasks posts
 * usage logs to a Google endpoint from inside the worker. The CSP blocks that
 * where the server sends it; this keeps the worker on the app origin when a
 * host serves the files without the header.
 */
export const sameOriginFetch =
  (nativeFetch: Fetch, origin: string): Fetch =>
  (input, init) => {
    const target = new URL(urlOf(input), origin);
    if (target.origin !== origin) {
      return Promise.reject(new TypeError(`Blocked request to ${target.origin}`));
    }
    return nativeFetch(input, init);
  };
