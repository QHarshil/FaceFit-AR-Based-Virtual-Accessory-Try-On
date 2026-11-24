import { describe, expect, it, vi } from 'vitest';
import {
  installSameOriginGuard,
  sameOriginFetch,
  type GuardedApi,
  type GuardedScope,
} from '../sameOriginGuard';

const ORIGIN = 'http://localhost:4177';
const USAGE_LOG = 'https://odml.pa.googleapis.com/v1/log';

describe('sameOriginFetch', () => {
  it('rejects the MediaPipe usage log endpoint without calling fetch', async () => {
    const nativeFetch = vi.fn(() => Promise.resolve(new Response('')));
    const guarded = sameOriginFetch(nativeFetch, ORIGIN);

    await expect(guarded(USAGE_LOG, { method: 'POST' })).rejects.toThrow(
      'Blocked request to https://odml.pa.googleapis.com',
    );
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

class FakeXhr {
  opened: unknown[][] = [];
  open(...args: unknown[]) {
    this.opened.push(args);
  }
}

interface FakeScope extends GuardedScope {
  XMLHttpRequest: typeof FakeXhr;
  importScripts: (...urls: string[]) => void;
}

const fakeScope = (overrides: Pick<GuardedScope, 'importScripts' | 'navigator'> = {}) => {
  const fetch = vi.fn(() => Promise.resolve(new Response('')));
  const importScripts = vi.fn<(...urls: string[]) => void>();
  // A fresh class per scope, so patching its prototype stays inside one test.
  const Xhr = class extends FakeXhr {};
  const scope: FakeScope = {
    location: { origin: ORIGIN },
    fetch,
    XMLHttpRequest: Xhr,
    importScripts,
    ...overrides,
  };
  const blocked: [GuardedApi, string][] = [];
  installSameOriginGuard(scope, (api, url) => blocked.push([api, url]));
  return { scope, fetch, importScripts, blocked };
};

describe('installSameOriginGuard', () => {
  it('blocks and reports an off-origin fetch, without the query string', async () => {
    const { scope, fetch, blocked } = fakeScope();

    await expect(scope.fetch(`${USAGE_LOG}?key=abc`, { method: 'POST' })).rejects.toThrow(
      TypeError,
    );
    await scope.fetch('/mediapipe/face_landmarker.task');

    expect(blocked).toEqual([['fetch', USAGE_LOG]]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('blocks and reports an off-origin XMLHttpRequest and opens same-origin ones', () => {
    const { scope, blocked } = fakeScope();
    const xhr = new scope.XMLHttpRequest();

    expect(() => {
      xhr.open('POST', USAGE_LOG);
    }).toThrow(expect.objectContaining({ name: 'SecurityError' }) as Error);
    xhr.open('GET', '/api/products', true);

    expect(blocked).toEqual([['xhr', USAGE_LOG]]);
    expect(xhr.opened).toEqual([['GET', '/api/products', true]]);
  });

  it('blocks an off-origin importScripts with an error tasks-vision will not retry', () => {
    const { scope, importScripts, blocked } = fakeScope();

    let thrown: unknown;
    try {
      scope.importScripts('/ok.js', 'https://cdn.example.com/loader.js');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown).toMatchObject({ name: 'SecurityError' });
    expect(blocked).toEqual([['importScripts', 'https://cdn.example.com/loader.js']]);
    expect(importScripts).not.toHaveBeenCalled();
  });

  it('passes same-origin importScripts through, including the module worker TypeError', () => {
    const moduleWorkerImport = vi.fn(() => {
      throw new TypeError('Module scripts do not support importScripts().');
    });
    const { scope, blocked } = fakeScope({ importScripts: moduleWorkerImport });

    expect(() => {
      scope.importScripts?.(`${ORIGIN}/mediapipe/loader.js`);
    }).toThrow(TypeError);
    expect(moduleWorkerImport).toHaveBeenCalledWith(`${ORIGIN}/mediapipe/loader.js`);
    expect(blocked).toEqual([]);
  });

  it('refuses an off-origin beacon where sendBeacon exists', () => {
    const sendBeacon = vi.fn(() => true);
    const { scope, blocked } = fakeScope({ navigator: { sendBeacon } });

    expect(scope.navigator?.sendBeacon?.(USAGE_LOG, 'payload')).toBe(false);
    expect(scope.navigator?.sendBeacon?.('/beacon', 'payload')).toBe(true);

    expect(blocked).toEqual([['sendBeacon', USAGE_LOG]]);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('leaves APIs the scope lacks undefined', () => {
    const scope: GuardedScope = {
      location: { origin: ORIGIN },
      fetch: vi.fn(() => Promise.resolve(new Response(''))),
      navigator: {},
    };
    installSameOriginGuard(scope, () => {});

    expect(scope.importScripts).toBeUndefined();
    expect(scope.XMLHttpRequest).toBeUndefined();
    expect(scope.navigator?.sendBeacon).toBeUndefined();
  });
});
