import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import FaceMeshComponent from '../components/FaceMeshComponent';

const VirtualTryOn = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Simulate AR initialization
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000); // Adjust the delay based on real initialization time

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
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

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <p className="text-lg text-gray-600">Initializing AR experience...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center min-h-[300px]">
            <p className="text-lg text-red-600">
              Oops! Something went wrong. Please try again later.
            </p>
            <Link
              to="/products"
              className="mt-4 bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600"
            >
              Back to Products
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <p className="text-lg text-gray-600 mb-4">
              Align your face with the camera to try on our products!
            </p>
            <div className="w-full max-w-screen-md bg-gray-100 rounded-lg shadow-lg p-4">
              <FaceMeshComponent />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default VirtualTryOn;
