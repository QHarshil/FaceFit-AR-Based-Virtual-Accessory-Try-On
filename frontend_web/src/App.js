import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Navbar from './pages/Navbar';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import ProductList from './pages/ProductList';
import ProductManagement from './pages/ProductManagement';
import VirtualTryOn from './pages/VirtualTryOn';
import Dashboard from './pages/Dashboard';
import TryOnOptions from './pages/TryOnOptions';

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <div className="min-h-screen bg-gray-50">
          <Navbar />
          <main className="container mx-auto px-4 py-8">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/products" element={<ProductList />} />
              <Route path="/management" element={<ProductManagement />} />
              <Route path="/try-on/:productId" element={<VirtualTryOn />} /> {/* Updated route for specific products */}
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/try-on-options" element={<TryOnOptions />} /> {/* Add try-on options route */}
            </Routes>
          </main>
        </div>
      </AuthProvider>
    </Router>
  );
}
