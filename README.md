# FaceFit: AR Virtual Accessory Try-On App

## Project Overview

This project is an **Augmented Reality (AR) Virtual Try-On application** designed to let users preview face-related products such as glasses, makeup, and face accessories in real-time using their device's camera. The app leverages AR and computer vision to overlay 3D models and filters onto the user’s face, helping them visualize how different products look before purchasing.

## Features

- **Real-Time Facial Detection**: Uses MediaPipe to detect facial landmarks and overlay virtual products.
- **3D Model Rendering**: Integrates Three.js for real-time rendering of glasses and accessories.
- **AR Filters**: Uses OpenCV to apply makeup filters like lipstick, eyeshadow, and blush.
- **Product Customization**: Allows users to adjust the size, color, and position of selected products.
- **Cross-Platform Compatibility**: Built with React Native for compatibility across iOS and Android.

## Tech Stack

### Backend
- **Flask**: Lightweight web framework for handling API requests.
- **PostgreSQL**: Relational database for storing product data and user preferences.
- **SQLAlchemy**: ORM for database interaction.
- **OpenCV**: Image processing for makeup and AR filter application.

### Frontend
- **React Native**: Cross-platform mobile app framework.
- **MediaPipe**: Real-time face detection and landmark tracking.
- **Three.js**: Rendering of 3D models for virtual products.

## Project Structure

```plaintext
FaceFit/
├── backend/
│   ├── app.py                       # Main Flask application
│   ├── config.py                    # Configuration settings (e.g., for DB connection, app secrets)
│   ├── db.py                        # PostgreSQL database connection and initialization
│   ├── models/                      # SQLAlchemy models for products, users, and preferences
│   │   ├── product.py               # Product model for storing glasses, makeup, accessories
│   │   ├── user.py                  # User model for storing user-specific preferences
│   │   └── customization.py         # Model for storing customization details (colors, sizes)
│   ├── routes/                      # API routes for managing products, categories, and preferences
│   │   ├── products.py              # API routes for fetching product data
│   │   ├── preferences.py           # API routes for saving and retrieving user preferences
│   │   └── categories.py            # API route for fetching product categories (glasses, makeup, etc.)
│   ├── services/                    # Business logic and services (e.g., applying makeup filters, adjusting accessories)
│   │   └── filter_service.py        # Service for handling OpenCV filters (makeup, AR effects)
│   ├── static/                      # Static files (e.g., 3D models for glasses, accessories)
│   ├── tests/                       # Unit tests for the backend
│   │   ├── test_products.py         # Unit tests for product fetching APIs
│   │   └── test_preferences.py      # Unit tests for user preferences API
│   ├── requirements.txt             # List of project dependencies (Flask, SQLAlchemy, etc.)
│   └── README.md                    # Project documentation
└── frontend/
    ├── App.js                       # Main React Native entry point
    ├── components/                  # Reusable components for product display, camera feed, customization
    │   ├── CameraFeed.js            # Camera feed component for real-time facial tracking with MediaPipe
    │   ├── ProductCarousel.js       # Carousel for displaying products (glasses, makeup)
    │   └── CustomizationPanel.js    # Panel for customizing products (colors, sizes, positioning)
    ├── services/                    # API service calls to interact with the backend
    │   ├── productService.js        # Service for fetching product data from the backend
    │   └── preferenceService.js     # Service for saving and retrieving user preferences
    ├── assets/                      # Static assets such as 3D models for glasses and accessory textures
    │   ├── models/                  # 3D models for glasses, accessories
    │   └── textures/                # Textures for accessories, makeup filters
    ├── utils/                       # Utility functions for face detection, customization
    │   └── faceMeshUtils.js         # Utility functions for MediaPipe face detection and mesh manipulation
    ├── styles/                      # Styles and theming for the frontend components
    ├── tests/                       # Unit and integration tests for frontend components
    │   ├── test_CameraFeed.js       # Tests for camera and facial detection integration
    │   └── test_ProductCarousel.js  # Tests for product carousel functionality
    └── README.md                    # Project documentation and setup guide
