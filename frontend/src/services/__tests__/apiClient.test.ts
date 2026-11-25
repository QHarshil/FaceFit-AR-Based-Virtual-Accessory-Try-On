import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTS } from '../../test/fixtures';
import { API_BASE_URL, ApiError, apiFailureOf, getProductById, getProducts } from '../apiClient';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (respond: () => Promise<Response>) => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(respond);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const failureOf = async (request: Promise<unknown>) => {
    try {
      await request;
    } catch (error) {
      return error instanceof ApiError ? error.failure : 'not an ApiError';
    }
    return 'resolved';
  };

  it('requests and validates the full product catalogue', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(200, PRODUCTS)));

    const result = await getProducts();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_BASE_URL}/api/products`);
    expect(result).toEqual(PRODUCTS);
  });

  it('requests a product by id', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(200, PRODUCTS[1])));

    expect(await getProductById(2)).toEqual(PRODUCTS[1]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_BASE_URL}/api/products/2`);
  });

  it('tells a missing product from a network failure', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(404, { error: 'Product not found' })));
    expect(await failureOf(getProductById(99))).toBe('not_found');

    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await failureOf(getProductById(1))).toBe('network');

    stubFetch(() => Promise.resolve(jsonResponse(503, { error: 'Service unavailable' })));
    expect(await failureOf(getProductById(1))).toBe('server_error');

    stubFetch(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    expect(await failureOf(getProductById(1))).toBe('timeout');
  });

  it('rejects a body that does not match the contract', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [{ id: 1 }])));
    expect(await failureOf(getProducts())).toBe('invalid_response');

    stubFetch(() => Promise.resolve(new Response('<html>', { status: 200 })));
    expect(await failureOf(getProducts())).toBe('invalid_response');
  });

  it('passes the caller abort through without reporting it as a failure', async () => {
    const controller = new AbortController();
    stubFetch(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    await expect(getProductById(1, controller.signal)).rejects.toThrow('aborted');
  });

  it('treats an unknown error as a network failure', () => {
    expect(apiFailureOf(new Error('x'))).toBe('network');
    expect(apiFailureOf(new ApiError('not_found', 'gone'))).toBe('not_found');
  });

  it('defaults the API base URL to localhost:5055', async () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.resetModules();

    const { API_BASE_URL: baseUrl } = await import('../apiClient');

    expect(baseUrl).toBe('http://localhost:5055');
    vi.unstubAllEnvs();
  });
});
