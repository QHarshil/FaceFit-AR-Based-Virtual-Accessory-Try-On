import React, { useState, useEffect } from 'react';
import ModelUploader from '../components/ModelUploader';

const ProductManagement = () => {
  const [products, setProducts] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const response = await fetch('http://localhost:8081/api/products');
      if (!response.ok) throw new Error('Failed to fetch products');
      const data = await response.json();
      setProducts(data);
    } catch (error) {
      setError(error.message);
      console.error('Failed to fetch products:', error);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Product Management</h1>
      {error && <div className="text-red-500 mb-4">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((product) => (
          <div key={product.id} className="bg-white rounded-lg shadow-md p-4">
            <h2 className="text-lg font-semibold mb-2">{product.name}</h2>
            <p className="text-gray-600 mb-4">Category: {product.category}</p>

            {/* Model Uploader */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Upload 3D Model
              </label>
              <ModelUploader productId={product.id} />
            </div>

            {/* Preview current model if exists */}
            {product.modelPath && (
              <div className="mt-4">
                <p className="text-sm text-gray-500">Current model: {product.modelPath}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProductManagement;
