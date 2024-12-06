import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Dashboard = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-r from-gray-100 to-blue-50">
      <header className="bg-blue-500 text-white py-6 shadow-md">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-3xl font-bold">Welcome, {user?.username || 'User'}!</h1>
          <p className="text-lg mt-2">Here's a quick overview of your activity.</p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card: Total Products Tried */}
          <div className="bg-white shadow-md rounded-lg p-6">
            <h2 className="text-2xl font-semibold text-gray-800 mb-2">Total Products Tried</h2>
            <p className="text-gray-600 text-lg">12</p>
            <Link
              to="/try-on"
              className="block mt-4 text-blue-500 hover:text-blue-700 transition font-medium"
            >
              Explore More Products →
            </Link>
          </div>

          {/* Card: Favorites */}
          <div className="bg-white shadow-md rounded-lg p-6">
            <h2 className="text-2xl font-semibold text-gray-800 mb-2">Your Favorites</h2>
            <p className="text-gray-600 text-lg">5</p>
            <Link
              to="/favorites"
              className="block mt-4 text-blue-500 hover:text-blue-700 transition font-medium"
            >
              View Favorites →
            </Link>
          </div>

          {/* Card: Recently Viewed */}
          <div className="bg-white shadow-md rounded-lg p-6">
            <h2 className="text-2xl font-semibold text-gray-800 mb-2">Recently Viewed</h2>
            <p className="text-gray-600 text-lg">3</p>
            <Link
              to="/recent"
              className="block mt-4 text-blue-500 hover:text-blue-700 transition font-medium"
            >
              See Your History →
            </Link>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-3xl font-bold text-gray-800 mb-6">Quick Links</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <Link
              to="/try-on"
              className="block bg-blue-500 text-white text-center py-4 rounded-lg shadow-md hover:bg-blue-600 transition"
            >
              Try Products
            </Link>
            <Link
              to="/products"
              className="block bg-gray-500 text-white text-center py-4 rounded-lg shadow-md hover:bg-gray-600 transition"
            >
              Manage Products
            </Link>
            <Link
              to="/profile"
              className="block bg-blue-500 text-white text-center py-4 rounded-lg shadow-md hover:bg-blue-600 transition"
            >
              Edit Profile
            </Link>
            <Link
              to="/logout"
              className="block bg-red-500 text-white text-center py-4 rounded-lg shadow-md hover:bg-red-600 transition"
            >
              Logout
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
