import { getProductById, getProducts, API_BASE_URL } from '../apiClient';

describe('apiClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
    jest.clearAllMocks();
  });

  it('requests the full product catalogue', async () => {
    const catalogue = [{ id: 1 }, { id: 2 }];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(catalogue),
    });

    const result = await getProducts();

    expect(global.fetch).toHaveBeenCalledWith(`${API_BASE_URL}/api/products`);
    expect(result).toEqual(catalogue);
  });

  it('requests a product by id', async () => {
    const product = { id: 7 };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(product),
    });

    const result = await getProductById(7);

    expect(global.fetch).toHaveBeenCalledWith(`${API_BASE_URL}/api/products/7`);
    expect(result).toEqual(product);
  });

  it('throws a descriptive error when the response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Product not found' }),
    });

    await expect(getProductById(999)).rejects.toThrow('Product not found');
  });
});
