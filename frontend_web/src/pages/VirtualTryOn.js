import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ModelViewer from '../components/ModelViewer';

const VirtualTryOn = () => {
  const { productId } = useParams();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modelUrl, setModelUrl] = useState(null);

  useEffect(() => {
    const fetchModel = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`http://localhost:8081/api/products/${productId}/model`);
        if (!response.ok) throw new Error('Failed to fetch model.');
        const data = await response.json();
        setModelUrl(data.modelUrl); // Assuming the backend returns { modelUrl: "URL_TO_MODEL" }
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchModel();
  }, [productId]);

  if (isLoading) {
    return <div className="text-center text-lg">Loading AR experience...</div>;
  }

  if (error) {
    return (
      <div className="text-center text-red-600">
        <p>{error}</p>
        <Link to="/products" className="text-blue-500 underline">
          Back to Products
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-md py-4">
        <div className="container mx-auto px-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">Virtual Try-On</h1>
          <Link
            to="/products"
            className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
          >
            Back to Products
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {modelUrl ? (
          <ModelViewer modelUrl={modelUrl} />
        ) : (
          <p className="text-lg text-gray-600">No model available for this product.</p>
        )}
      </main>
    </div>
  );
};

export default VirtualTryOn;
