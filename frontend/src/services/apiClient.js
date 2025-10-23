const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const buildUrl = (path) => {
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_URL}${trimmedPath}`;
};

const parseJson = async (response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.error ||
      payload?.message ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload;
};

export const getProducts = async () => {
  const response = await fetch(buildUrl('/api/products'));
  return parseJson(response);
};

export const getProductById = async (id) => {
  if (!id) {
    throw new Error('Product id is required');
  }
  const response = await fetch(buildUrl(`/api/products/${id}`));
  return parseJson(response);
};

export { API_URL as API_BASE_URL };
