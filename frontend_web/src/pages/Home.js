import React from 'react';
import { Link } from 'react-router-dom';

const Home = () => {
  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-50 to-gray-100">
      {/* Hero Section */}
      <header className="flex flex-col items-center justify-center text-center py-16">
        <h1 className="text-5xl font-extrabold text-gray-800 mb-4">
          Welcome to <span className="text-blue-500">FaceFit</span>
        </h1>
        <p className="text-lg text-gray-600 mb-8">
          Revolutionizing the way you try on accessories using AR technology.
        </p>
        <div className="space-x-4">
          <Link
            to="/try-on"
            className="bg-blue-500 text-white px-6 py-3 rounded-lg shadow-md hover:bg-blue-600 transition duration-300"
          >
            Try Products
          </Link>
          <Link
            to="/register"
            className="bg-gray-500 text-white px-6 py-3 rounded-lg shadow-md hover:bg-gray-600 transition duration-300"
          >
            Sign Up
          </Link>
        </div>
      </header>

      {/* Featured Products Section */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-8 text-gray-800">
          Featured Products
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Dynamically render product cards here */}
          {[1, 2, 3].map((_, index) => (
            <div
              key={index}
              className="bg-white rounded-lg shadow-lg p-6 text-center"
            >
              <div className="h-40 bg-gray-200 rounded-md mb-4">
                {/* Placeholder for product image */}
                <span className="text-gray-500 text-sm">Product Image</span>
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">
                Product Name
              </h3>
              <p className="text-gray-600 text-sm mb-4">Product Description</p>
              <Link
                to="/try-on"
                className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition duration-300"
              >
                Try On
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Key Features Section */}
      <section className="bg-gray-100 py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-8 text-gray-800">
            Why Choose FaceFit?
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-blue-500 text-white rounded-full flex items-center justify-center">
                {/* Placeholder for icon */}
                <span className="text-2xl">🎥</span>
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">
                Real-time AR
              </h3>
              <p className="text-gray-600 text-sm">
                Experience seamless augmented reality for virtual try-ons.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-blue-500 text-white rounded-full flex items-center justify-center">
                {/* Placeholder for icon */}
                <span className="text-2xl">🛍️</span>
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">
                Wide Range of Products
              </h3>
              <p className="text-gray-600 text-sm">
                Browse a large selection of accessories tailored to your style.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-blue-500 text-white rounded-full flex items-center justify-center">
                {/* Placeholder for icon */}
                <span className="text-2xl">👍</span>
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">
                Easy to Use
              </h3>
              <p className="text-gray-600 text-sm">
                Our platform is designed to make virtual try-ons simple and fun.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
