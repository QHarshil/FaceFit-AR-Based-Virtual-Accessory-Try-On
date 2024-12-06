import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Dashboard = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <header className="bg-white shadow-md py-4">
        <div className="container mx-auto px-4">
          <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Welcome, {user?.username || 'Guest'}!</h2>
          <p className="text-gray-600 mb-6">
            Manage your products, explore the AR virtual try-on experience, and more.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Link
              to="/products"
              className="block bg-blue-500 text-white py-4 px-6 rounded-lg shadow-md text-center hover:bg-blue-600"
            >
              View Products
            </Link>
            <Link
              to="/management"
              className="block bg-green-500 text-white py-4 px-6 rounded-lg shadow-md text-center hover:bg-green-600"
            >
              Manage Products
            </Link>
            <Link
              to="/try-on"
              className="block bg-purple-500 text-white py-4 px-6 rounded-lg shadow-md text-center hover:bg-purple-600"
            >
              AR Try-On Experience
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
