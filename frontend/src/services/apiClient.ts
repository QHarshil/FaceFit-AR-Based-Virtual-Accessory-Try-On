import type { Product } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5055';

interface ErrorPayload {
  error?: string;
  message?: string;
}

const buildUrl = (path: string): string => {
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_URL}${trimmedPath}`;
};

const parseJson = async <T>(response: Response): Promise<T> => {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = (payload ?? {}) as ErrorPayload;
    const message =
      failure.error || failure.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
};

export const getProducts = async (): Promise<Product[]> => {
  const response = await fetch(buildUrl('/api/products'));
  return parseJson<Product[]>(response);
};

export const getProductById = async (id: string | number | undefined): Promise<Product> => {
  if (!id) {
    throw new Error('Product id is required');
  }
  const response = await fetch(buildUrl(`/api/products/${id}`));
  return parseJson<Product>(response);
};

export { API_URL as API_BASE_URL };
