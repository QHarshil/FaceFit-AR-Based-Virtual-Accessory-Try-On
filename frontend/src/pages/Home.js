import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/Home.css';
import { getProducts } from '../services/apiClient';
import { sendTelemetry } from '../utils/telemetry';

const CAPABILITIES = [
  {
    title: 'Robust Landmark Tracking',
    description: 'MediaPipe Face Mesh delivers 468 3D landmarks per frame, making it possible to align eyewear accurately without training a bespoke model.'
  },
  {
    title: 'Geometric Pose Estimation',
    description: 'Three.js applies pose matrices derived from inter-eye vectors and forehead anchors, stabilising virtual frames as the user rotates.'
  },
  {
    title: 'Reproducible Delivery',
    description: 'A React SPA and Node.js API run inside Docker containers, so experiments can be repeated on any machine with the same configuration.'
  }
];

const LOADING_PLACEHOLDERS = Array.from({ length: 4 }, (_, index) => index);
const ILLUSTRATION_THEMES = [
  { frame: '#1d4ed8', lens: '#bfdbfe', accent: '#2563eb', background: '#eff6ff' },
  { frame: '#047857', lens: '#bbf7d0', accent: '#0f766e', background: '#ecfdf5' },
  { frame: '#7c3aed', lens: '#ddd6fe', accent: '#6d28d9', background: '#f5f3ff' },
  { frame: '#dc2626', lens: '#fecaca', accent: '#b91c1c', background: '#fef2f2' },
];

function ProductImage({ product }) {
  const [failed, setFailed] = useState(false);
  const theme = ILLUSTRATION_THEMES[(product.id - 1) % ILLUSTRATION_THEMES.length];
  const hasValidImage = Boolean(product.image) && !failed;

  if (!hasValidImage) {
    return (
      <div
        className="product-illustration"
        style={{ backgroundColor: theme.background }}
      >
        <span
          className="product-illustration__temple product-illustration__temple--left"
          style={{ backgroundColor: theme.frame }}
        />
        <span
          className="product-illustration__lens product-illustration__lens--left"
          style={{ borderColor: theme.frame, backgroundColor: theme.lens }}
        />
        <span
          className="product-illustration__bridge"
          style={{ backgroundColor: theme.accent }}
        />
        <span
          className="product-illustration__lens product-illustration__lens--right"
          style={{ borderColor: theme.frame, backgroundColor: theme.lens }}
        />
        <span
          className="product-illustration__temple product-illustration__temple--right"
          style={{ backgroundColor: theme.frame }}
        />
      </div>
    );
  }

  return (
    <img
      src={product.image}
      alt={product.name}
      className="product-image"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function Home() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const loadProducts = async () => {
      setLoading(true);
      setError(null);
      try {
        const catalogue = await getProducts();
        if (!isMounted) return;
        setProducts(catalogue);
        sendTelemetry('catalogue_loaded', { count: catalogue.length });
      } catch (err) {
        if (!isMounted) return;
        console.error('Failed to load products:', err);
        setError('We could not reach the product catalogue. Please retry in a moment.');
        sendTelemetry('catalogue_failed', { message: err.message });
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadProducts();
    return () => {
      isMounted = false;
    };
  }, []);

  const [primaryProductId, secondaryProductId] = useMemo(() => {
    if (products.length === 0) {
      return [undefined, undefined];
    }
    return [products[0]?.id, products[1]?.id ?? products[0]?.id];
  }, [products]);

  const handleNavigate = (productId) => {
    if (!productId) return;
    navigate(`/try-on/${productId}`);
  };

  return (
    <div className="home-container">
      <header className="hero">
        <div className="hero-context">Applied computer vision prototype</div>
        <h1 className="hero-title">FaceFit AR</h1>
        <p className="hero-subtitle">
          Browser-based eyewear try-on that couples MediaPipe landmark extraction with lightweight pose estimation and Three.js rendering.
        </p>
        <div className="hero-cta">
          <button
            className="primary-action"
            onClick={() => handleNavigate(primaryProductId)}
            disabled={loading || !primaryProductId}
          >
            Launch Try-On
          </button>
          <button
            className="secondary-action"
            onClick={() => handleNavigate(secondaryProductId)}
            disabled={loading || !secondaryProductId}
          >
            Explore Catalogue
          </button>
        </div>
      </header>

      <section className="products-section">
        <h2 className="section-title">Select a Frame</h2>
        <p className="section-subtitle">
          Each item is served by the Express API and rendered in the AR viewport with its associated GLB model.
        </p>
        <div className="products-grid">
          {loading &&
            LOADING_PLACEHOLDERS.map((placeholder) => (
              <article key={`placeholder-${placeholder}`} className="product-card product-card--loading">
                <div className="product-image-container">
                  <div className="loading-skeleton image-skeleton" />
                </div>
                <div className="product-info">
                  <div className="loading-skeleton text-skeleton large" />
                  <div className="loading-skeleton text-skeleton small" />
                  <div className="loading-skeleton text-skeleton" />
                </div>
                <div className="loading-skeleton button-skeleton" />
              </article>
            ))}

          {!loading && !error && products.map((product) => (
            <article key={product.id} className="product-card">
              <div className="product-image-container">
                <ProductImage product={product} />
              </div>
              <div className="product-info">
                <h3 className="product-name">{product.name}</h3>
                <p className="product-category">{product.category}</p>
                <p className="product-description">{product.description}</p>
              </div>
              <button
                className="try-on-button"
                onClick={() => navigate(`/try-on/${product.id}`)}
              >
                Open Try-On
              </button>
            </article>
          ))}

          {!loading && error && (
            <article className="product-card product-card--error">
              <div className="product-info">
                <h3 className="product-name">Catalogue unavailable</h3>
                <p className="product-description">{error}</p>
              </div>
              <button
                className="try-on-button"
                onClick={() => window.location.reload()}
              >
                Retry
              </button>
            </article>
          )}
        </div>
      </section>

      <section className="capabilities-section">
        <h2 className="section-title">System Capabilities</h2>
        <div className="capabilities-grid">
          {CAPABILITIES.map((item) => (
            <div key={item.title} className="capability-card">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default Home;
