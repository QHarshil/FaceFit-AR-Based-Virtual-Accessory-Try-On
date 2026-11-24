// Keeps the landmark worker's network APIs on the app origin. MediaPipe Tasks
// posts usage logs to a Google endpoint from inside the worker. The CSP blocks
// that where the server sends it; this guard also covers hosts that serve the
// files without the header, and reports every attempt it blocks.

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const GUARDED_APIS = ['fetch', 'xhr', 'importScripts', 'sendBeacon'] as const;
export type GuardedApi = (typeof GUARDED_APIS)[number];

/** Receives the blocked URL without its query or fragment. */
export type OnBlocked = (api: GuardedApi, url: string) => void;

/** The parts of a worker global scope the guard replaces. */
export interface GuardedScope {
  location: { origin: string };
  fetch: Fetch;
  XMLHttpRequest?: { prototype: { open: (method: string, url: string | URL) => void } };
  importScripts?: (...urls: string[]) => void;
  navigator?: { sendBeacon?: (url: string | URL, data?: BodyInit | null) => boolean };
}

const urlOf = (input: RequestInfo | URL): string =>
  input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;

const leaving = (url: string | URL, origin: string): URL | null => {
  const target = new URL(url, origin);
  return target.origin === origin ? null : target;
};

const reported = (target: URL): string => `${target.origin}${target.pathname}`;

/** Wraps `fetch` so it rejects any URL outside `origin`. */
export const sameOriginFetch =
  (nativeFetch: Fetch, origin: string, onBlocked: OnBlocked = () => {}): Fetch =>
  (input, init) => {
    const target = leaving(urlOf(input), origin);
    if (target) {
      onBlocked('fetch', reported(target));
      return Promise.reject(new TypeError(`Blocked request to ${target.origin}`));
    }
    return nativeFetch(input, init);
  };

/** Replaces `fetch`, `XMLHttpRequest.open`, `importScripts` and `sendBeacon` where they exist. */
export const installSameOriginGuard = (scope: GuardedScope, onBlocked: OnBlocked): void => {
  const { origin } = scope.location;
  scope.fetch = sameOriginFetch(scope.fetch.bind(scope), origin, onBlocked);

  const xhr = scope.XMLHttpRequest?.prototype;
  if (xhr) {
    const nativeOpen = xhr.open;
    xhr.open = function open(this: unknown, ...args: Parameters<typeof nativeOpen>) {
      const target = leaving(args[1], origin);
      if (target) {
        onBlocked('xhr', reported(target));
        throw new DOMException(`Blocked request to ${target.origin}`, 'SecurityError');
      }
      Reflect.apply(nativeOpen, this, args);
    };
  }

  const nativeImportScripts = scope.importScripts;
  if (typeof nativeImportScripts === 'function') {
    scope.importScripts = (...urls) => {
      for (const url of urls) {
        const target = leaving(url, origin);
        if (!target) continue;
        onBlocked('importScripts', reported(target));
        // Not a TypeError: tasks-vision reads a TypeError from importScripts as
        // "module worker" and retries the same URL with import().
        throw new DOMException(`Blocked script from ${target.origin}`, 'SecurityError');
      }
      nativeImportScripts.apply(scope, urls);
    };
  }

  const navigator = scope.navigator;
  const nativeBeacon = navigator?.sendBeacon;
  if (navigator && typeof nativeBeacon === 'function') {
    navigator.sendBeacon = (url, data) => {
      const target = leaving(url, origin);
      if (target) {
        onBlocked('sendBeacon', reported(target));
        return false;
      }
      return nativeBeacon.call(navigator, url, data);
    };
  }
};
