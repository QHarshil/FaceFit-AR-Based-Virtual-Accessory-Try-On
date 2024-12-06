import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Navbar = () => {
  const { user, logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => setIsMenuOpen((prev) => !prev);

  return (
    <nav className="bg-white shadow-md sticky top-0 z-50">
      <div className="container mx-auto px-4 flex justify-between items-center h-16">
        {/* Logo */}
        <Link to="/" className="text-xl font-bold text-gray-800">
          FaceFit
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center space-x-4">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `text-gray-600 hover:text-gray-900 ${isActive ? 'font-bold' : ''}`
            }
          >
            Home
          </NavLink>
          <NavLink
            to="/products"
            className={({ isActive }) =>
              `text-gray-600 hover:text-gray-900 ${isActive ? 'font-bold' : ''}`
            }
          >
            Products
          </NavLink>
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `text-gray-600 hover:text-gray-900 ${isActive ? 'font-bold' : ''}`
            }
          >
            Dashboard
          </NavLink>

          {user ? (
            <>
              <span className="text-gray-800 font-medium">Hi, {user.username}</span>
              <button
                onClick={logout}
                className="bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <NavLink
                to="/login"
                className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
              >
                Login
              </NavLink>
              <NavLink
                to="/register"
                className="bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600"
              >
                Register
              </NavLink>
            </>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <div className="md:hidden">
          <button
            onClick={toggleMenu}
            className="text-gray-600 focus:outline-none"
            aria-label="Toggle navigation"
          >
            <svg
              className="h-6 w-6"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={isMenuOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'}
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {isMenuOpen && (
        <div className="md:hidden bg-white border-t border-gray-200">
          <NavLink
            to="/"
            className="block px-4 py-2 text-gray-600 hover:text-gray-900"
            onClick={toggleMenu}
          >
            Home
          </NavLink>
          <NavLink
            to="/products"
            className="block px-4 py-2 text-gray-600 hover:text-gray-900"
            onClick={toggleMenu}
          >
            Products
          </NavLink>
          <NavLink
            to="/dashboard"
            className="block px-4 py-2 text-gray-600 hover:text-gray-900"
            onClick={toggleMenu}
          >
            Dashboard
          </NavLink>
          {user ? (
            <>
              <button
                onClick={logout}
                className="block w-full text-left px-4 py-2 bg-red-500 text-white hover:bg-red-600"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <NavLink
                to="/login"
                className="block px-4 py-2 text-gray-600 hover:text-gray-900"
                onClick={toggleMenu}
              >
                Login
              </NavLink>
              <NavLink
                to="/register"
                className="block px-4 py-2 bg-gray-500 text-white hover:bg-gray-600"
                onClick={toggleMenu}
              >
                Register
              </NavLink>
            </>
          )}
        </div>
      )}
    </nav>
  );
};

export default Navbar;
