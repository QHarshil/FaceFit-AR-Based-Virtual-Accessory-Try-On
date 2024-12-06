import React, { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import FaceMeshComponent from "../components/FaceMeshComponent";
import ARTryOn from "../components/ARTryOn";

const VirtualTryOn = () => {
  const { productId } = useParams();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [product, setProduct] = useState(null);
  const arRef = useRef(null); // Reference to control ARTryOn dynamically

  // Fetch product details based on productId
  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`http://localhost:8081/api/products/${productId}`);
        if (!response.ok) throw new Error("Failed to fetch product details.");
        const data = await response.json();

        // Log the API response for debugging
        console.log("Product Data from API:", data);

        setProduct(data); // Assuming the backend response includes product details
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProduct();
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
      {/* Page Header */}
      <header className="bg-white shadow-md py-4">
        <div className="container mx-auto px-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">{product?.name || "Virtual Try-On"}</h1>
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
        {product?.modelUrl ? (
          <>
            {/* Display the model and category */}
            <p className="text-lg text-gray-600 mb-4">
              Align your face to try on the <span className="font-bold">{product.name}</span>!
            </p>
            <div className="relative w-full h-[calc(100vh-200px)]">
              {/* FaceMeshComponent handles face detection */}
              <FaceMeshComponent>
                {/* ARTryOn renders the model */}
                <ARTryOn
                  ref={arRef}
                  modelPath={product.modelUrl}
                  type={product.category}
                />
              </FaceMeshComponent>
            </div>
            <div className="mt-8">
              <h2 className="text-xl font-bold text-gray-800">Product Details</h2>
              <p className="text-gray-600 mt-2">Category: {product.category}</p>
            </div>
          </>
        ) : (
          <p className="text-lg text-gray-600">No model available for this product.</p>
        )}
      </main>
    </div>
  );
};

export default VirtualTryOn;
