import React, { useState, useEffect } from 'react';
import ProductCard from '../components/ProductCard';

const ProductList = () => {
  const [products, setProducts] = useState([]);
  const [category, setCategory] = useState('ALL');

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch(
          category === 'ALL' 
            ? '/api/products' 
            : `/api/products?category=${category}`
        );
        const data = await response.json();
        setProducts(data);
      } catch (error) {
        console.error('Error fetching products:', error);
      }
    };

    fetchProducts();
  }, [category]);

  return (
    <div>
      <div className="mb-6">
        <select 
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="p-2 border rounded-md"
        >
          <option value="ALL">All Categories</option>
          <option value="GLASSES">Glasses</option>
          <option value="HAT">Hats</option>
          <option value="JEWELRY">Jewelry</option>
        </select>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map(product => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
};

export default ProductList;