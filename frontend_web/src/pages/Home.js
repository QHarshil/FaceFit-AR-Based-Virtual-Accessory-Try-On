import React from 'react';
import { Link } from 'react-router-dom';

const Home = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center">
      <h1 className="text-4xl font-bold mb-4">Welcome to FaceFit</h1>
      <p className="text-xl text-gray-600 mb-8">
        Try on virtual accessories using AR technology
      </p>
      <div className="space-x-4">
        <Link
          to="/try-on"
          className="bg-blue-500 text-white px-6 py-3 rounded-md hover:bg-blue-600"
        >
          Try Products
        </Link>
        <Link
          to="/register"
          className="bg-gray-500 text-white px-6 py-3 rounded-md hover:bg-gray-600"
        >
          Sign Up
        </Link>
      </div>
    </div>
  );
};

export default Home;