import React from 'react';
import { Link } from 'react-router-dom';

const Home = () => {
  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-50 via-white to-gray-100">
      {/* Hero Section */}
      <header className="relative flex flex-col items-center justify-center text-center py-20 bg-gradient-to-r from-blue-500 to-indigo-500 text-white">
        <h1 className="text-6xl font-extrabold mb-4 drop-shadow-lg">
          Welcome to <span className="text-yellow-300">FaceFit</span>
        </h1>
        <p className="text-xl font-medium mb-8 drop-shadow-md">
          Revolutionizing the way you try on accessories with cutting-edge AR technology.
        </p>
        <div className="space-x-4">
          <Link
            to="/try-on"
            className="px-6 py-3 bg-yellow-400 text-blue-900 font-semibold rounded-lg shadow-lg hover:bg-yellow-500 transition transform hover:scale-105"
          >
            Try Products
          </Link>
          <Link
            to="/register"
            className="px-6 py-3 bg-white text-blue-900 font-semibold rounded-lg shadow-lg hover:bg-gray-200 transition transform hover:scale-105"
          >
            Sign Up
          </Link>
        </div>
        <div className="absolute bottom-0 left-0 right-0 flex justify-center pb-4 animate-bounce">
          <a href="#features" className="text-white text-3xl">
            ↓
          </a>
        </div>
      </header>

      {/* Featured Products Section */}
      <section id="features" className="container mx-auto px-4 py-16">
        <h2 className="text-4xl font-bold text-center mb-12 text-gray-800">
          Featured Products
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {[1, 2, 3].map((_, index) => (
            <div
              key={index}
              className="bg-white rounded-lg shadow-lg overflow-hidden transform transition-transform hover:scale-105"
            >
              <div className="h-48 bg-gray-200 flex items-center justify-center">
                {/* Placeholder for product image */}
                <span className="text-gray-500 text-lg font-semibold">
                  Product Image
                </span>
              </div>
              <div className="p-6 text-center">
                <h3 className="text-lg font-bold text-gray-800 mb-2">
                  Product Name
                </h3>
                <p className="text-gray-600 text-sm mb-4">
                  This is a brief description of the product, showcasing its key features.
                </p>
                <Link
                  to="/try-on"
                  className="inline-block px-4 py-2 bg-blue-500 text-white rounded-md shadow hover:bg-blue-600 transition"
                >
                  Try On
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Key Features Section */}
      <section className="bg-gray-100 py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center mb-12 text-gray-800">
            Why Choose FaceFit?
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12">
            <div className="text-center p-6 bg-white shadow-md rounded-lg transform transition-transform hover:scale-105">
              <div className="w-16 h-16 mx-auto mb-6 bg-blue-500 text-white rounded-full flex items-center justify-center">
                {/* Placeholder for icon */}
                <span className="text-3xl">🎥</span>
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">
                Real-time AR
              </h3>
              <p className="text-gray-600">
                Experience seamless augmented reality for virtual try-ons with unparalleled accuracy.
              </p>
            </div>
            <div className="text-center p-6 bg-white shadow-md rounded-lg transform transition-transform hover:scale-105">
              <div className="w-16 h-16 mx-auto mb-6 bg-blue-500 text-white rounded-full flex items-center justify-center">
                {/* Placeholder for icon */}
                <span className="text-3xl">🛍️</span>
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">
                Wide Range of Products
              </h3>
              <p className="text-gray-600">
                Browse through a diverse catalog of stylish accessories tailored to your taste.
              </p>
            </div>
            <div className="text-center p-6 bg-white shadow-md rounded-lg transform transition-transform hover:scale-105">
              <div className="w-16 h-16 mx-auto mb-6 bg-blue-500 text-white rounded-full flex items-center justify-center">
                {/* Placeholder for icon */}
                <span className="text-3xl">👍</span>
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">
                Easy to Use
              </h3>
              <p className="text-gray-600">
                A user-friendly interface designed to make virtual try-ons a breeze.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-16 bg-gradient-to-r from-indigo-500 to-blue-500 text-white">
        <div className="container mx-auto text-center">
          <h2 className="text-4xl font-extrabold mb-6">
            Ready to Transform Your Style?
          </h2>
          <p className="text-lg font-medium mb-8">
            Sign up now to access a personalized AR experience with FaceFit.
          </p>
          <Link
            to="/register"
            className="px-8 py-4 bg-yellow-400 text-blue-900 font-semibold rounded-lg shadow-lg hover:bg-yellow-500 transition transform hover:scale-105"
          >
            Get Started
          </Link>
        </div>
      </section>
    </div>
  );
};

export default Home;
