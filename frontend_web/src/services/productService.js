import { API_ENDPOINTS, apiRequest } from '../config/api';

export const productService = {

  getAllProducts: async () => {
    return await apiRequest(API_ENDPOINTS.PRODUCTS);
  },

  getProductsByCategory: async (category) => {
    return await apiRequest(`${API_ENDPOINTS.PRODUCTS}?category=${category}`);
  },

  getProductById: async (id) => {
    return await apiRequest(`${API_ENDPOINTS.PRODUCTS}/${id}`);
  },

  createProduct: async (productData) => {
    return await apiRequest(API_ENDPOINTS.PRODUCTS, {
      method: 'POST',
      body: JSON.stringify(productData),
    });
  },

  updateProduct: async (id, productData) => {
    return await apiRequest(`${API_ENDPOINTS.PRODUCTS}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(productData),
    });
  },

  deleteProduct: async (id) => {
    return await apiRequest(`${API_ENDPOINTS.PRODUCTS}/${id}`, {
      method: 'DELETE',
    });
  },
};