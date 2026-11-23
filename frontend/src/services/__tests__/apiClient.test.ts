import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, getProductById, getProducts } from '../apiClient';

describe('apiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (response: Partial<Response>) => {
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('requests the full product catalogue', async () => {
    const catalogue = [{ id: 1 }, { id: 2 }];
    const fetchMock = stubFetch({ ok: true, json: () => Promise.resolve(catalogue) });

    const result = await getProducts();

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/api/products`);
    expect(result).toEqual(catalogue);
  });

  it('requests a product by id', async () => {
    const product = { id: 7 };
    const fetchMock = stubFetch({ ok: true, json: () => Promise.resolve(product) });

    const result = await getProductById(7);

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/api/products/7`);
    expect(result).toEqual(product);
  });

  it('throws a descriptive error when the response is not ok', async () => {
    stubFetch({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Product not found' }),
    });

    await expect(getProductById(999)).rejects.toThrow('Product not found');
  });

  it('rejects when a successful response has no JSON body', async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });

    await expect(getProducts()).rejects.toThrow('Response was not valid JSON');
  });

  it('defaults the API base URL to localhost:5055', async () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.resetModules();

    const { API_BASE_URL: baseUrl } = await import('../apiClient');

    expect(baseUrl).toBe('http://localhost:5055');
    vi.unstubAllEnvs();
  });
});
